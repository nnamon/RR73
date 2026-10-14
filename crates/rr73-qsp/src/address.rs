//! Where QSP may connect for a receiver a user names. Such a receiver must be on a public address
//! and must not be this machine, so no user reaches the relay's own services, or the networks
//! behind it, through QSP. A name is resolved once per connection attempt, and the connection goes
//! to the address checked, so a name that changes its answer in between gains nothing.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use tokio::net::TcpStream;

/// Why QSP will not connect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// The name has no address.
    NotFound(String),
    /// Every address the name gave is private, loopback, link-local or reserved.
    NotPublic(String),
    /// The connection reached this machine.
    ItsOwn,
    /// No address answered; the last error.
    Unreachable(String),
}

impl Refusal {
    /// What happened, in words.
    pub fn message(&self) -> String {
        match self {
            Refusal::NotFound(host) => format!("No address found for {host}."),
            Refusal::NotPublic(host) => {
                format!("{host} is not on the public internet. This relay connects only to public receivers.")
            }
            Refusal::ItsOwn => "The receiver’s address is this relay’s own.".into(),
            Refusal::Unreachable(e) => format!("The receiver did not answer: {e}."),
        }
    }
}

/// Whether an address is on the public internet. IPv4: none of this network, private,
/// shared (100.64/10), loopback, link-local (cloud metadata at 169.254.169.254 among them),
/// protocol, documentation, benchmarking, multicast, reserved or broadcast. IPv6: global unicast
/// (2000::/3) outside the protocol block (2001::/23), documentation (2001:db8::/32, 3fff::/20) and
/// 6to4 (2002::/16); an IPv4-mapped address counts as its IPv4 address.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => public_v4(v4),
            None => public_v6(v6),
        },
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    let special = a == 0
        || a == 10
        || (a == 100 && (64..128).contains(&b))
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..32).contains(&b))
        || (a == 192 && b == 0 && (c == 0 || c == 2))
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224;
    !special
}

fn public_v6(ip: Ipv6Addr) -> bool {
    let [s0, s1, ..] = ip.segments();
    (s0 & 0xe000) == 0x2000
        && !(s0 == 0x2001 && s1 < 0x0200)
        && !(s0 == 0x2001 && s1 == 0x0db8)
        && !(s0 == 0x3fff && s1 < 0x1000)
        && s0 != 0x2002
}

/// The addresses to try for a receiver, in the resolver's order: all of them, or for a receiver
/// a user named only the public ones.
pub async fn resolve(host: &str, port: u16, public_only: bool) -> Result<Vec<SocketAddr>, Refusal> {
    let found: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| Refusal::NotFound(host.into()))?
        .collect();
    if found.is_empty() {
        return Err(Refusal::NotFound(host.into()));
    }
    if !public_only {
        return Ok(found);
    }
    let public: Vec<SocketAddr> = found.into_iter().filter(|a| is_public(a.ip())).collect();
    if public.is_empty() {
        return Err(Refusal::NotPublic(host.into()));
    }
    Ok(public)
}

/// Connects to the first address that answers. For a receiver a user named, a connection that
/// reached this machine is dropped before anything is sent: connecting to its own public address
/// goes over the loopback interface, past a firewall that guards the public one.
pub async fn connect(addrs: &[SocketAddr], public_only: bool) -> Result<(TcpStream, SocketAddr), Refusal> {
    let mut last = "no address to connect to".to_string();
    for &addr in addrs {
        match TcpStream::connect(addr).await {
            Ok(s) => {
                if public_only && reaches_itself(&s) {
                    return Err(Refusal::ItsOwn);
                }
                return Ok((s, addr));
            }
            Err(e) => last = e.to_string(),
        }
    }
    Err(Refusal::Unreachable(last))
}

/// Whether a connection ends at this machine: the local and remote addresses match, as they do
/// for any address of its own.
fn reaches_itself(s: &TcpStream) -> bool {
    match (s.local_addr(), s.peer_addr()) {
        (Ok(l), Ok(p)) => l.ip().to_canonical() == p.ip().to_canonical(),
        _ => true,
    }
}

/// The host as it goes in a URL or a Host header: an IPv6 address in brackets.
pub fn url_host(host: &str) -> String {
    if host.parse::<Ipv6Addr>().is_ok() {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("an address")
    }

    #[test]
    fn public_addresses_pass_and_every_special_range_is_refused() {
        for a in [
            "8.8.8.8",
            "1.1.1.1",
            "167.172.88.10",
            "100.63.255.255",
            "100.128.0.0",
            "172.15.255.255",
            "172.32.0.0",
            "192.0.1.1",
            "198.17.255.255",
            "198.20.0.0",
            "223.255.255.255",
            "2001:4860:4860::8888",
            "2400:6180:0:d1::1",
            "2001:200::1",
            "::ffff:8.8.8.8",
        ] {
            assert!(is_public(ip(a)), "{a} is public");
        }
        for a in [
            "0.0.0.0",
            "0.1.2.3",
            "10.0.0.1",
            "100.64.0.1",
            "100.127.255.255",
            "127.0.0.1",
            "127.8.8.8",
            "169.254.169.254",
            "172.16.0.1",
            "172.31.255.255",
            "192.0.0.8",
            "192.0.2.1",
            "192.88.99.1",
            "192.168.1.50",
            "198.18.0.1",
            "198.19.255.255",
            "198.51.100.7",
            "203.0.113.9",
            "224.0.0.1",
            "239.255.255.250",
            "240.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:192.168.1.1",
            "::ffff:169.254.169.254",
            "64:ff9b::808:808",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "fec0::1",
            "ff02::1",
            "2001::1",
            "2001:1ff:ffff::1",
            "2001:db8::1",
            "3fff::1",
            "3fff:fff::1",
            "2002:c0a8:101::1",
            "100::1",
        ] {
            assert!(!is_public(ip(a)), "{a} is not public");
        }
    }

    #[tokio::test]
    async fn a_user_named_receiver_resolves_only_to_public_addresses() {
        // Addresses and localhost only: no name here goes to a DNS server.
        assert_eq!(
            resolve("127.0.0.1", 8073, true).await,
            Err(Refusal::NotPublic("127.0.0.1".into()))
        );
        assert_eq!(
            resolve("192.168.1.50", 8073, true).await,
            Err(Refusal::NotPublic("192.168.1.50".into()))
        );
        assert_eq!(
            resolve("::1", 8073, true).await,
            Err(Refusal::NotPublic("::1".into()))
        );
        assert_eq!(
            resolve("localhost", 8073, true).await,
            Err(Refusal::NotPublic("localhost".into()))
        );
        assert_eq!(
            resolve("8.8.8.8", 8073, true).await,
            Ok(vec!["8.8.8.8:8073".parse().expect("an address")])
        );
        // The relay's own receivers may be anywhere.
        assert_eq!(
            resolve("127.0.0.1", 8073, false).await,
            Ok(vec!["127.0.0.1:8073".parse().expect("an address")])
        );
    }

    #[tokio::test]
    async fn a_connection_that_reaches_this_machine_is_dropped() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a loopback listener");
        let addr = listener.local_addr().expect("its address");
        let (s, to) = connect(&[addr], false)
            .await
            .expect("the relay's own receivers connect");
        assert_eq!(to, addr);
        assert!(reaches_itself(&s));
        assert_eq!(connect(&[addr], true).await.err(), Some(Refusal::ItsOwn));
    }

    #[test]
    fn ipv6_hosts_go_in_brackets() {
        assert_eq!(url_host("2001:db8::1"), "[2001:db8::1]");
        assert_eq!(url_host("kiwi.example.org"), "kiwi.example.org");
        assert_eq!(url_host("8.8.8.8"), "8.8.8.8");
    }
}
