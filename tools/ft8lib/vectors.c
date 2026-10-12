/*
 * vectors: test-vector generator for rr73-ft8, linked against ft8_lib.
 *
 * Copyright (c) 2026 RR73 contributors. MIT licence, see LICENSE-MIT.
 *
 * gfsk_pulse() and synth_gfsk() are adapted from demo/gen_ft8.c in ft8_lib,
 * Copyright (c) 2018 Kārlis Goba, MIT licence. The decoder set-up in cmd_decode()
 * follows demo/decode_ft8.c in the same project.
 *
 * Subcommands (all output is JSON on stdout):
 *
 *   vectors cases CASES_FILE SECTIONS_FILE STATES_FILE
 *       One vector per line of CASES_FILE: payload, 91-bit message, codeword and tones
 *       for FT8 and FT4. Payloads come from ft8_lib's packer where it supports the
 *       message type; the remaining types are packed here from the field definitions
 *       in the QEX paper, Appendix A, and marked "packer": "generator".
 *
 *   vectors decode [-ft4] WAV...
 *       Decodes each WAV with ft8_lib and prints every distinct payload whose text matches a
 *       line of the reference decode list next to the WAV, with that line's text. The
 *       payloads show bit for bit what on-air transmitters send.
 *
 *   vectors waveform ft8|ft4 F0_HZ SAMPLE_RATE HEAD STRIDE MESSAGE_TEXT
 *       Packs MESSAGE_TEXT with ft8_lib, synthesises it with ft8_lib's GFSK modulator
 *       and prints the first and last HEAD samples plus every STRIDE-th sample.
 */
#define _POSIX_C_SOURCE 200809L
#include <ctype.h>
#include <math.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ft8/constants.h"
#include "ft8/crc.h"
#include "ft8/decode.h"
#include "ft8/encode.h"
#include "ft8/message.h"

#include "common/monitor.h"
#include "common/wave.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define NTOKENS  2063592u
#define MAX22    4194304u
#define MAXGRID4 32400u

static void die(const char* fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "vectors: ");
    vfprintf(stderr, fmt, ap);
    fprintf(stderr, "\n");
    va_end(ap);
    exit(1);
}

/* ------------------------------------------------------------------------------------------ */
/* Callsign hash table used by ft8_lib's packer and unpacker.                                  */

#define HASH_CAPACITY 1024

static struct
{
    char callsign[12];
    uint32_t n22;
} hash_table[HASH_CAPACITY];
static int hash_count;

static void hash_save(const char* callsign, uint32_t n22)
{
    for (int i = 0; i < hash_count; ++i)
    {
        if (0 == strcmp(hash_table[i].callsign, callsign))
        {
            hash_table[i].n22 = n22;
            return;
        }
    }
    if (hash_count == HASH_CAPACITY)
        die("hash table full");
    snprintf(hash_table[hash_count].callsign, sizeof(hash_table[hash_count].callsign), "%s", callsign);
    hash_table[hash_count].n22 = n22;
    ++hash_count;
}

static bool hash_lookup(ftx_callsign_hash_type_t type, uint32_t hash, char* callsign)
{
    int shift = (type == FTX_CALLSIGN_HASH_22_BITS) ? 0 : (type == FTX_CALLSIGN_HASH_12_BITS ? 10 : 12);
    /* Most recent entry wins, as in the Rust table. */
    for (int i = hash_count - 1; i >= 0; --i)
    {
        if ((hash_table[i].n22 >> shift) == hash)
        {
            strcpy(callsign, hash_table[i].callsign);
            return true;
        }
    }
    callsign[0] = '\0';
    return false;
}

static ftx_callsign_hash_interface_t hash_if = { .lookup_hash = hash_lookup, .save_hash = hash_save };

/* 22-bit hash as defined by program hashcodes in the public protocol description. */
static uint32_t hash22(const char* call)
{
    static const char table[] = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/";
    uint64_t n = 0;
    int i = 0;
    for (; call[i] != '\0'; ++i)
    {
        const char* p = strchr(table, call[i]);
        if (p == NULL || i >= 11)
            die("cannot hash '%s'", call);
        n = 38 * n + (uint64_t)(p - table);
    }
    for (; i < 11; ++i)
        n *= 38;
    return (uint32_t)((47055833459ull * n) >> 42) & 0x3FFFFFu;
}

/* Returns ft8_lib's 22-bit hash of a callsign, captured through the save_hash callback. */
static uint32_t ft8lib_hash22(const char* call)
{
    ftx_message_t tmp;
    ftx_message_init(&tmp);
    if (ftx_message_encode_nonstd(&tmp, &hash_if, call, "K1ABC", "") != FTX_MESSAGE_RC_OK)
        die("ft8_lib cannot hash '%s'", call);
    for (int i = 0; i < hash_count; ++i)
        if (0 == strcmp(hash_table[i].callsign, call))
            return hash_table[i].n22;
    die("ft8_lib did not save '%s'", call);
    return 0;
}

static uint32_t checked_hash22(const char* call)
{
    uint32_t ours = hash22(call);
    uint32_t theirs = ft8lib_hash22(call);
    if (ours != theirs)
        die("hash mismatch for '%s': %u vs %u", call, ours, theirs);
    return ours;
}

/* ------------------------------------------------------------------------------------------ */
/* Bit access on a 77-bit payload, MSB first.                                                  */

typedef struct
{
    uint8_t* bytes;
    int pos;
} bitwriter_t;

static void put_bits(bitwriter_t* w, uint64_t value, int nbits)
{
    for (int i = nbits - 1; i >= 0; --i)
    {
        int bit = (int)((value >> i) & 1u);
        uint8_t mask = (uint8_t)(0x80u >> (w->pos % 8));
        if (bit)
            w->bytes[w->pos / 8] |= mask;
        else
            w->bytes[w->pos / 8] &= (uint8_t)~mask;
        ++w->pos;
    }
}

static uint64_t get_bits(const uint8_t* bytes, int pos, int nbits)
{
    uint64_t v = 0;
    for (int i = 0; i < nbits; ++i, ++pos)
        v = (v << 1) | ((bytes[pos / 8] >> (7 - pos % 8)) & 1u);
    return v;
}

static void set_bits(uint8_t* bytes, int pos, uint64_t value, int nbits)
{
    bitwriter_t w = { bytes, pos };
    put_bits(&w, value, nbits);
}

/* ------------------------------------------------------------------------------------------ */
/* Field encoders for the message types ft8_lib does not pack (QEX paper, Appendix A).        */

static char section_names[128][4];
static int section_count;
static char state_names[128][4];
static int state_count;

/* Reads the abbreviations from a Fortran data statement such as arrl_rac_sections.txt. */
static int read_name_list(const char* path, char names[][4])
{
    FILE* f = fopen(path, "r");
    if (f == NULL)
        die("cannot open %s", path);
    int count = 0;
    char line[256];
    while (fgets(line, sizeof(line), f))
    {
        if (line[0] == '!')
            continue;
        for (char* p = strchr(line, '"'); p != NULL; p = strchr(p, '"'))
        {
            char* end = strchr(p + 1, '"');
            if (end == NULL)
                break;
            int len = 0;
            for (char* q = p + 1; q < end && *q != ' ' && len < 3; ++q)
                names[count][len++] = *q;
            names[count][len] = '\0';
            ++count;
            p = end + 1;
        }
    }
    fclose(f);
    return count;
}

static int find_name(char names[][4], int count, const char* name)
{
    for (int i = 0; i < count; ++i)
        if (0 == strcmp(names[i], name))
            return i;
    die("unknown abbreviation '%s'", name);
    return -1;
}

static bool is_bracketed(const char* call)
{
    size_t n = strlen(call);
    return n >= 2 && call[0] == '<' && call[n - 1] == '>';
}

static void strip_brackets(char* out, size_t size, const char* call)
{
    if (is_bracketed(call))
        snprintf(out, size, "%.*s", (int)(strlen(call) - 2), call + 1);
    else
        snprintf(out, size, "%s", call);
}

/* c28 for a station without /R or /P flag: a standard call in full, or a 22-bit hash. */
static uint32_t c28_station(const char* call)
{
    char bare[16];
    strip_brackets(bare, sizeof(bare), call);
    if (!is_bracketed(call))
    {
        int32_t n = pack_basecall(bare, (int)strlen(bare));
        if (n >= 0)
            return NTOKENS + MAX22 + (uint32_t)n;
    }
    return NTOKENS + checked_hash22(bare);
}

static void record_call(const char* call)
{
    char bare[16];
    strip_brackets(bare, sizeof(bare), call);
    hash_save(bare, checked_hash22(bare));
}

static uint32_t g25(const char* grid6)
{
    if (strlen(grid6) != 6)
        die("bad grid6 '%s'", grid6);
    return (uint32_t)(grid6[0] - 'A') * 18 * 10 * 10 * 24 * 24 + (uint32_t)(grid6[1] - 'A') * 10 * 10 * 24 * 24
         + (uint32_t)(grid6[2] - '0') * 10 * 24 * 24 + (uint32_t)(grid6[3] - '0') * 24 * 24
         + (uint32_t)(grid6[4] - 'A') * 24 + (uint32_t)(grid6[5] - 'A');
}

/* ------------------------------------------------------------------------------------------ */
/* JSON output.                                                                                */

static void json_string(const char* s)
{
    putchar('"');
    for (; *s; ++s)
    {
        if (*s == '"' || *s == '\\')
            printf("\\%c", *s);
        else
            putchar(*s);
    }
    putchar('"');
}

static void json_hex(const uint8_t* bytes, int n)
{
    putchar('"');
    for (int i = 0; i < n; ++i)
        printf("%02x", bytes[i]);
    putchar('"');
}

/* Prints the 91-bit message, codeword and tones of a payload for one mode. */
static void json_mode(const uint8_t payload[10], bool ft4)
{
    uint8_t scrambled[10];
    for (int i = 0; i < 10; ++i)
        scrambled[i] = ft4 ? (uint8_t)(payload[i] ^ kFT4_XOR_sequence[i]) : payload[i];
    uint8_t a91[12];
    ftx_add_crc(scrambled, a91);

    int nn = ft4 ? FT4_NN : FT8_NN;
    uint8_t tones[FT4_NN];
    if (ft4)
        ft4_encode(payload, tones);
    else
        ft8_encode(payload, tones);

    /* The codeword is read back from ft8_lib's tones through the inverse Gray map and
       printed as 22 bytes, MSB first, with the last 2 bits zero. */
    uint8_t codeword[FTX_LDPC_N_BYTES] = { 0 };
    int nbits = 0;
    for (int i = 0; i < nn; ++i)
    {
        bool sync;
        if (ft4)
            sync = i == 0 || i == 104 || (i >= 1 && i < 5) || (i >= 34 && i < 38) || (i >= 67 && i < 71) || (i >= 100 && i < 104);
        else
            sync = i < 7 || (i >= 36 && i < 43) || i >= 72;
        if (sync)
            continue;
        int bits_per_symbol = ft4 ? 2 : 3;
        int value = -1;
        for (int v = 0; v < (1 << bits_per_symbol); ++v)
            if ((ft4 ? kFT4_Gray_map[v] : kFT8_Gray_map[v]) == tones[i])
                value = v;
        for (int b = bits_per_symbol - 1; b >= 0; --b, ++nbits)
            if ((value >> b) & 1)
                codeword[nbits / 8] |= (uint8_t)(0x80u >> (nbits % 8));
    }
    if (nbits != FTX_LDPC_N)
        die("codeword length %d", nbits);

    char tone_text[FT4_NN + 1];
    for (int i = 0; i < nn; ++i)
        tone_text[i] = (char)('0' + tones[i]);
    tone_text[nn] = '\0';

    printf("{\"message91\": ");
    json_hex(a91, 12);
    printf(", \"codeword\": ");
    json_hex(codeword, FTX_LDPC_N_BYTES);
    printf(", \"tones\": ");
    json_string(tone_text);
    printf("}");
}

/* ------------------------------------------------------------------------------------------ */
/* cases                                                                                       */

#define MAX_FIELDS 10

static int split(char* line, char* fields[MAX_FIELDS])
{
    int n = 0;
    char* p = line;
    while (n < MAX_FIELDS)
    {
        fields[n++] = p;
        char* bar = strchr(p, '|');
        if (bar == NULL)
            break;
        *bar = '\0';
        p = bar + 1;
    }
    return n;
}

static void need_fields(int n, int expected, const char* kind, int line_no)
{
    if (n != expected)
        die("line %d: %s needs %d fields, has %d", line_no, kind, expected, n);
}

/* Packs one case. Returns the expected text (last field) and sets *packer and *ft8lib_text. */
static void pack_case(char* fields[], int n, int line_no, uint8_t payload[10], const char** packer, bool* decodable,
                      uint8_t alt_payload[10], bool* has_alt)
{
    const char* kind = fields[0];
    ftx_message_t msg;
    ftx_message_init(&msg);
    *packer = "ft8_lib";
    *decodable = true;
    *has_alt = false;

    if (0 == strcmp(kind, "std"))
    {
        /* std|TO|DE|EXTRA|TEXT. A bracketed call is sent as a 22-bit hash. EXTRA "R GRID" sets R1. */
        need_fields(n, 5, kind, line_no);
        char to[16], de[16];
        strip_brackets(to, sizeof(to), fields[1]);
        strip_brackets(de, sizeof(de), fields[2]);
        for (int i = 1; i <= 2; ++i)
        {
            size_t len = strlen(fields[i]);
            if (is_bracketed(fields[i]) && len > 3 && fields[i][len - 3] == '/')
                die("line %d: a bracketed call with /P or /R changes i3; not supported here", line_no);
        }
        const char* extra = fields[3];
        bool r_grid = (strncmp(extra, "R ", 2) == 0);
        if (ftx_message_encode_std(&msg, &hash_if, to, de, r_grid ? extra + 2 : extra) != FTX_MESSAGE_RC_OK)
            die("line %d: ft8_lib cannot pack std message", line_no);
        if (r_grid)
        {
            set_bits(msg.payload, 58, 1, 1);
            *packer = "ft8_lib+R1";
        }
        if (is_bracketed(fields[1]))
        {
            set_bits(msg.payload, 0, ((uint64_t)NTOKENS + checked_hash22(to)) << 1, 29);
            *packer = "ft8_lib+hash22";
        }
        if (is_bracketed(fields[2]))
        {
            set_bits(msg.payload, 29, ((uint64_t)NTOKENS + checked_hash22(de)) << 1, 29);
            *packer = "ft8_lib+hash22";
        }
        if (0 == strcmp(extra, "RR73"))
        {
            /* ft8_lib and the public description send RR73 as g15 = 32403. Every RR73 in the
               on-air recordings uses the locator RR73 (32373). The vector carries the on-air
               form and keeps ft8_lib's form as the alternative. */
            memcpy(alt_payload, msg.payload, 10);
            *has_alt = true;
            set_bits(msg.payload, 59, 32373, 15);
            *packer = "ft8_lib+g15";
        }
    }
    else if (0 == strcmp(kind, "nonstd"))
    {
        /* nonstd|HASHED|FULL|EXTRA|H1|TEXT. H1 = 1 writes the hashed call second. */
        need_fields(n, 6, kind, line_no);
        char hashed[16];
        strip_brackets(hashed, sizeof(hashed), fields[1]);
        if (ftx_message_encode_nonstd(&msg, &hash_if, hashed, fields[2], fields[3]) != FTX_MESSAGE_RC_OK)
            die("line %d: ft8_lib cannot pack nonstd message", line_no);
        /* ft8_lib's encoder only writes H1 = 0 (its flip test reads past the string). Both
           layouts carry the hashed call in h12 and the full call in c58, so H1 is set here. */
        if (0 == strcmp(fields[4], "1"))
        {
            set_bits(msg.payload, 70, 1, 1);
            *packer = "ft8_lib+h1";
        }
    }
    else if (0 == strcmp(kind, "nonstdcq"))
    {
        /* nonstdcq|FULL|TEXT. The paper says h12 is ignored when c1 = 1. ft8_lib writes zero;
           every type 4 CQ in the on-air recordings carries the 12-bit hash of the full
           callsign. The vector carries the on-air form and keeps ft8_lib's form as the
           alternative. */
        need_fields(n, 3, kind, line_no);
        if (ftx_message_encode_nonstd(&msg, &hash_if, "CQ", fields[1], "") != FTX_MESSAGE_RC_OK)
            die("line %d: ft8_lib cannot pack nonstd CQ", line_no);
        memcpy(alt_payload, msg.payload, 10);
        *has_alt = true;
        set_bits(msg.payload, 0, checked_hash22(fields[1]) >> 10, 12);
        *packer = "ft8_lib+h12";
    }
    else if (0 == strcmp(kind, "free"))
    {
        /* free|TEXT|TEXT. The public description (program free_text_to_f71) right-justifies
           the text in 13 characters; ft8_lib pads on the right. Both are emitted. */
        need_fields(n, 3, kind, line_no);
        char right[14];
        snprintf(right, sizeof(right), "%13s", fields[1]);
        if (ftx_message_encode_free(&msg, right) != FTX_MESSAGE_RC_OK)
            die("line %d: ft8_lib cannot pack free text", line_no);
        ftx_message_t left;
        ftx_message_init(&left);
        if (ftx_message_encode_free(&left, fields[1]) != FTX_MESSAGE_RC_OK)
            die("line %d: ft8_lib cannot pack free text", line_no);
        memcpy(alt_payload, left.payload, 10);
        *has_alt = true;
        *packer = "ft8_lib+right-justified";
    }
    else if (0 == strcmp(kind, "telemetry"))
    {
        /* telemetry|HEX|TEXT, up to 18 hex digits. */
        need_fields(n, 3, kind, line_no);
        uint8_t t72[9] = { 0 };
        const char* hex = fields[1];
        int len = (int)strlen(hex);
        for (int i = 0; i < len; ++i)
        {
            int digit = isdigit((unsigned char)hex[i]) ? hex[i] - '0' : hex[i] - 'A' + 10;
            int nib = 18 - len + i; /* right-aligned */
            t72[nib / 2] |= (uint8_t)(digit << ((nib % 2) ? 0 : 4));
        }
        ftx_message_encode_telemetry(&msg, t72);
        set_bits(msg.payload, 71, 5, 3); /* n3 = 5 */
        set_bits(msg.payload, 74, 0, 3); /* i3 = 0 */
        *packer = "ft8_lib+n3";
    }
    else if (0 == strcmp(kind, "dxped"))
    {
        /* dxped|CALL1|CALL2|FOX|REPORT|TEXT: c28 c28 h10 r5 n3=1 i3=0 */
        need_fields(n, 6, kind, line_no);
        int report = atoi(fields[4]);
        bitwriter_t w = { msg.payload, 0 };
        put_bits(&w, c28_station(fields[1]), 28);
        put_bits(&w, c28_station(fields[2]), 28);
        put_bits(&w, checked_hash22(fields[3]) >> 12, 10);
        put_bits(&w, (uint64_t)((report + 30) / 2), 5);
        put_bits(&w, 1, 3);
        put_bits(&w, 0, 3);
        record_call(fields[1]);
        record_call(fields[2]);
        record_call(fields[3]);
        *packer = "generator";
        *decodable = false;
    }
    else if (0 == strcmp(kind, "fd"))
    {
        /* fd|TO|DE|R|NTX|CLASS|SECTION|TEXT: c28 c28 R1 n4 k3 S7 n3=3|4 i3=0 */
        need_fields(n, 8, kind, line_no);
        int ntx = atoi(fields[4]);
        int n3 = ntx <= 16 ? 3 : 4;
        bitwriter_t w = { msg.payload, 0 };
        put_bits(&w, c28_station(fields[1]), 28);
        put_bits(&w, c28_station(fields[2]), 28);
        put_bits(&w, (uint64_t)atoi(fields[3]), 1);
        put_bits(&w, (uint64_t)(ntx - (n3 == 3 ? 1 : 17)), 4);
        put_bits(&w, (uint64_t)(fields[5][0] - 'A'), 3);
        put_bits(&w, (uint64_t)find_name(section_names, section_count, fields[6]), 7);
        put_bits(&w, (uint64_t)n3, 3);
        put_bits(&w, 0, 3);
        record_call(fields[1]);
        record_call(fields[2]);
        *packer = "generator";
        *decodable = false;
    }
    else if (0 == strcmp(kind, "rtty"))
    {
        /* rtty|TU|TO|DE|R|RST|EXCH|TEXT: t1 c28 c28 R1 r3 s13 i3=3 */
        need_fields(n, 8, kind, line_no);
        int rst = atoi(fields[5]);
        const char* exch = fields[6];
        uint32_t s13 = isdigit((unsigned char)exch[0]) ? (uint32_t)atoi(exch)
                                                       : 8001u + (uint32_t)find_name(state_names, state_count, exch);
        bitwriter_t w = { msg.payload, 0 };
        put_bits(&w, (uint64_t)atoi(fields[1]), 1);
        put_bits(&w, c28_station(fields[2]), 28);
        put_bits(&w, c28_station(fields[3]), 28);
        put_bits(&w, (uint64_t)atoi(fields[4]), 1);
        put_bits(&w, (uint64_t)((rst / 10) % 10 - 2), 3);
        put_bits(&w, s13, 13);
        put_bits(&w, 3, 3);
        record_call(fields[2]);
        record_call(fields[3]);
        *packer = "generator";
        *decodable = false;
    }
    else if (0 == strcmp(kind, "euvhf"))
    {
        /* euvhf|CALL1|CALL2|R|RS|SERIAL|GRID6|TEXT: h12 h22 R1 r3 s11 g25 i3=5 */
        need_fields(n, 8, kind, line_no);
        int rs = atoi(fields[4]);
        bitwriter_t w = { msg.payload, 0 };
        put_bits(&w, checked_hash22(fields[1]) >> 10, 12);
        put_bits(&w, checked_hash22(fields[2]), 22);
        put_bits(&w, (uint64_t)atoi(fields[3]), 1);
        put_bits(&w, (uint64_t)(rs % 10 - 2), 3);
        put_bits(&w, (uint64_t)atoi(fields[5]), 11);
        put_bits(&w, g25(fields[6]), 25);
        put_bits(&w, 5, 3);
        record_call(fields[1]);
        record_call(fields[2]);
        *packer = "generator";
        *decodable = false;
    }
    else
    {
        die("line %d: unknown kind '%s'", line_no, kind);
    }
    memcpy(payload, msg.payload, 10);
}

static int cmd_cases(const char* cases_path, const char* sections_path, const char* states_path)
{
    section_count = read_name_list(sections_path, section_names);
    state_count = read_name_list(states_path, state_names);
    if (section_count != 84 || state_count != 65)
        die("expected 84 sections and 65 states, read %d and %d", section_count, state_count);

    FILE* f = fopen(cases_path, "r");
    if (f == NULL)
        die("cannot open %s", cases_path);

    printf("{\n  \"generator\": \"tools/ft8lib/vectors.c with ft8_lib 9fec6ca\",\n");
    printf("  \"sections\": [");
    for (int i = 0; i < section_count; ++i)
        printf("%s\"%s\"", i ? ", " : "", section_names[i]);
    printf("],\n  \"states\": [");
    for (int i = 0; i < state_count; ++i)
        printf("%s\"%s\"", i ? ", " : "", state_names[i]);
    printf("],\n  \"vectors\": [\n");

    char line[512];
    int line_no = 0;
    int count = 0;
    while (fgets(line, sizeof(line), f))
    {
        ++line_no;
        line[strcspn(line, "\r\n")] = '\0';
        if (line[0] == '\0' || line[0] == '#')
            continue;
        char* fields[MAX_FIELDS];
        int n = split(line, fields);
        const char* text = fields[n - 1];

        uint8_t payload[10] = { 0 };
        uint8_t alt[10] = { 0 };
        const char* packer;
        bool decodable, has_alt;
        pack_case(fields, n, line_no, payload, &packer, &decodable, alt, &has_alt);

        char ft8lib_text[FTX_MAX_MESSAGE_LENGTH + 32] = "";
        if (decodable)
        {
            ftx_message_t msg;
            memcpy(msg.payload, payload, 10);
            ftx_message_offsets_t offsets;
            if (ftx_message_decode(&msg, &hash_if, ft8lib_text, &offsets) != FTX_MESSAGE_RC_OK)
                die("line %d: ft8_lib cannot unpack its own payload", line_no);
            if (0 != strcmp(ft8lib_text, text))
                die("line %d: ft8_lib unpacks '%s', case expects '%s'", line_no, ft8lib_text, text);
        }

        printf("%s    {\"kind\": ", count ? ",\n" : "");
        json_string(fields[0]);
        printf(", \"text\": ");
        json_string(text);
        printf(", \"i3\": %d, \"n3\": %d", (int)get_bits(payload, 74, 3), (int)get_bits(payload, 71, 3));
        printf(", \"packer\": ");
        json_string(packer);
        printf(", \"payload\": ");
        json_hex(payload, 10);
        if (has_alt)
        {
            printf(", \"ft8lib_payload\": ");
            json_hex(alt, 10);
        }
        printf(",\n     \"ft8\": ");
        json_mode(payload, false);
        printf(",\n     \"ft4\": ");
        json_mode(payload, true);
        printf("}");
        ++count;
    }
    printf("\n  ]\n}\n");
    fclose(f);
    fprintf(stderr, "vectors: %d cases\n", count);
    return 0;
}

/* ------------------------------------------------------------------------------------------ */
/* decode                                                                                      */

/* Copies a message with every <...> or <CALL> token replaced by <...>. */
static void normalise_hashes(char* out, size_t size, const char* text)
{
    size_t o = 0;
    for (const char* p = text; *p && o + 6 < size;)
    {
        if (*p == '<')
        {
            const char* close = strchr(p, '>');
            if (close != NULL)
            {
                memcpy(out + o, "<...>", 5);
                o += 5;
                p = close + 1;
                continue;
            }
        }
        out[o++] = *p++;
    }
    out[o] = '\0';
}

#define MAX_REFERENCE_LINES 256

/* Reads the reference decodes for a WAV from the .txt file next to it (WSJT-X output
   format): the text after "~  ", cut at the first run of two spaces, which separates the
   country name the decoder appends. */
static int read_reference(const char* wav_path, char lines[][64])
{
    char path[512];
    snprintf(path, sizeof(path), "%s", wav_path);
    char* dot = strrchr(path, '.');
    if (dot == NULL)
        return 0;
    strcpy(dot, ".txt");
    FILE* f = fopen(path, "r");
    if (f == NULL)
        return 0;
    int n = 0;
    char line[256];
    while (n < MAX_REFERENCE_LINES && fgets(line, sizeof(line), f))
    {
        line[strcspn(line, "\r\n")] = '\0';
        char* text = strstr(line, "~  ");
        if (text == NULL)
            continue;
        text += 3;
        char* gap = strstr(text, "  ");
        if (gap != NULL)
            *gap = '\0';
        snprintf(lines[n++], 64, "%s", text);
    }
    fclose(f);
    return n;
}

/* Decodes WAV files with ft8_lib and prints each distinct payload whose text matches a line
   in the reference decode list next to the WAV (hash tokens compared as <...>). */
static int cmd_decode(int argc, char** argv)
{
    ftx_protocol_t protocol = FTX_PROTOCOL_FT8;
    int first = 0;
    if (argc > 0 && 0 == strcmp(argv[0], "-ft4"))
    {
        protocol = FTX_PROTOCOL_FT4;
        first = 1;
    }
    static uint8_t seen[4096][10];
    int num_seen = 0;
    int matched = 0, unmatched = 0, decodes = 0;
    printf("[\n");
    for (int a = first; a < argc; ++a)
    {
        int sample_rate = 12000;
        int num_samples = 15 * 48000;
        float* signal = malloc(sizeof(float) * (size_t)num_samples);
        if (signal == NULL || load_wav(signal, &num_samples, &sample_rate, argv[a]) < 0)
            die("cannot load %s", argv[a]);
        static char reference[MAX_REFERENCE_LINES][64];
        int num_reference = read_reference(argv[a], reference);

        monitor_t mon;
        monitor_config_t cfg = {
            .f_min = 200, .f_max = 3000, .sample_rate = sample_rate, .time_osr = 2, .freq_osr = 2, .protocol = protocol
        };
        monitor_init(&mon, &cfg);
        for (int pos = 0; pos + mon.block_size <= num_samples; pos += mon.block_size)
            monitor_process(&mon, signal + pos);

        ftx_candidate_t candidates[200];
        int num_candidates = ftx_find_candidates(&mon.wf, 200, candidates, 10);
        for (int i = 0; i < num_candidates; ++i)
        {
            ftx_message_t message;
            ftx_decode_status_t status;
            if (!ftx_decode_candidate(&mon.wf, &candidates[i], 25, &message, &status))
                continue;
            bool dup = false;
            for (int j = 0; j < num_seen && !dup; ++j)
                dup = 0 == memcmp(seen[j], message.payload, 10);
            if (dup || num_seen == 4096)
                continue;
            memcpy(seen[num_seen++], message.payload, 10);
            ++decodes;

            char text[FTX_MAX_MESSAGE_LENGTH + 32];
            ftx_message_offsets_t offsets;
            if (ftx_message_decode(&message, &hash_if, text, &offsets) != FTX_MESSAGE_RC_OK)
                snprintf(text, sizeof(text), "(unpack error)");
            char ours[96], theirs[96];
            normalise_hashes(ours, sizeof(ours), text);
            const char* match = NULL;
            for (int r = 0; r < num_reference && match == NULL; ++r)
            {
                normalise_hashes(theirs, sizeof(theirs), reference[r]);
                if (0 == strcmp(ours, theirs))
                    match = reference[r];
            }
            if (match == NULL)
            {
                ++unmatched;
                fprintf(stderr, "vectors: no reference line for '%s' in %s\n", text, argv[a]);
                continue;
            }
            printf("%s  {\"file\": ", matched ? ",\n" : "");
            json_string(strncmp(argv[a], "./", 2) == 0 ? argv[a] + 2 : argv[a]);
            printf(", \"payload\": ");
            json_hex(message.payload, 10);
            printf(", \"reference_text\": ");
            json_string(match);
            printf("}");
            ++matched;
        }
        monitor_free(&mon);
        free(signal);
    }
    printf("\n]\n");
    fprintf(stderr, "vectors: %d distinct decodes, %d matched the reference, %d unmatched\n", decodes, matched,
            unmatched);
    return 0;
}

/* ------------------------------------------------------------------------------------------ */
/* waveform: adapted from ft8_lib demo/gen_ft8.c (Kārlis Goba, MIT).                           */

#define GFSK_CONST_K 5.336446f /* pi * sqrt(2 / log(2)) */

static void gfsk_pulse(int n_spsym, float symbol_bt, float* pulse)
{
    for (int i = 0; i < 3 * n_spsym; ++i)
    {
        float t = i / (float)n_spsym - 1.5f;
        float arg1 = GFSK_CONST_K * symbol_bt * (t + 0.5f);
        float arg2 = GFSK_CONST_K * symbol_bt * (t - 0.5f);
        pulse[i] = (erff(arg1) - erff(arg2)) / 2;
    }
}

static void synth_gfsk(const uint8_t* symbols, int n_sym, float f0, float symbol_bt, float symbol_period, int signal_rate,
                       float* signal)
{
    int n_spsym = (int)(0.5f + signal_rate * symbol_period);
    int n_wave = n_sym * n_spsym;
    float hmod = 1.0f;
    float dphi_peak = 2 * M_PI * hmod / n_spsym;
    float* dphi = malloc(sizeof(float) * (size_t)(n_wave + 2 * n_spsym));
    float* pulse = malloc(sizeof(float) * (size_t)(3 * n_spsym));
    if (dphi == NULL || pulse == NULL)
        die("out of memory");

    for (int i = 0; i < n_wave + 2 * n_spsym; ++i)
        dphi[i] = 2 * M_PI * f0 / signal_rate;
    gfsk_pulse(n_spsym, symbol_bt, pulse);
    for (int i = 0; i < n_sym; ++i)
    {
        int ib = i * n_spsym;
        for (int j = 0; j < 3 * n_spsym; ++j)
            dphi[j + ib] += dphi_peak * symbols[i] * pulse[j];
    }
    for (int j = 0; j < 2 * n_spsym; ++j)
    {
        dphi[j] += dphi_peak * pulse[j + n_spsym] * symbols[0];
        dphi[j + n_sym * n_spsym] += dphi_peak * pulse[j] * symbols[n_sym - 1];
    }
    float phi = 0;
    for (int k = 0; k < n_wave; ++k)
    {
        signal[k] = sinf(phi);
        phi = fmodf(phi + dphi[k + n_spsym], 2 * M_PI);
    }
    int n_ramp = n_spsym / 8;
    for (int i = 0; i < n_ramp; ++i)
    {
        float env = (1 - cosf(2 * M_PI * i / (2 * n_ramp))) / 2;
        signal[i] *= env;
        signal[n_wave - 1 - i] *= env;
    }
    free(dphi);
    free(pulse);
}

static void json_samples(const float* x, int from, int to, int step)
{
    printf("[");
    for (int k = from, first = 1; k < to; k += step, first = 0)
        printf("%s%.6f", first ? "" : ",", x[k]);
    printf("]");
}

static int cmd_waveform(int argc, char** argv)
{
    if (argc != 6)
        die("waveform needs MODE F0_HZ SAMPLE_RATE HEAD STRIDE MESSAGE_TEXT");
    bool ft4 = 0 == strcmp(argv[0], "ft4");
    float f0 = (float)atof(argv[1]);
    int rate = atoi(argv[2]);
    int head = atoi(argv[3]);
    int stride = atoi(argv[4]);
    const char* text = argv[5];

    ftx_message_t msg;
    ftx_message_init(&msg);
    if (ftx_message_encode(&msg, &hash_if, text) != FTX_MESSAGE_RC_OK)
        die("ft8_lib cannot pack '%s'", text);
    int nn = ft4 ? FT4_NN : FT8_NN;
    uint8_t tones[FT4_NN];
    if (ft4)
        ft4_encode(msg.payload, tones);
    else
        ft8_encode(msg.payload, tones);
    float period = ft4 ? FT4_SYMBOL_PERIOD : FT8_SYMBOL_PERIOD;
    float bt = ft4 ? 1.0f : 2.0f;
    int n_spsym = (int)(0.5f + rate * period);
    int n_wave = nn * n_spsym;
    float* signal = malloc(sizeof(float) * (size_t)n_wave);
    if (signal == NULL)
        die("out of memory");
    synth_gfsk(tones, nn, f0, bt, period, rate, signal);

    char tone_text[FT4_NN + 1];
    for (int i = 0; i < nn; ++i)
        tone_text[i] = (char)('0' + tones[i]);
    tone_text[nn] = '\0';

    printf("{\"mode\": \"%s\", \"text\": ", ft4 ? "ft4" : "ft8");
    json_string(text);
    printf(", \"f0_hz\": %.4f, \"sample_rate\": %d, \"amplitude\": 1.0, \"tones\": ", f0, rate);
    json_string(tone_text);
    printf(", \"n_samples\": %d, \"head_len\": %d, \"stride\": %d,\n   \"head\": ", n_wave, head, stride);
    json_samples(signal, 0, head, 1);
    printf(",\n   \"tail\": ");
    json_samples(signal, n_wave - head, n_wave, 1);
    printf(",\n   \"strided\": ");
    json_samples(signal, 0, n_wave, stride);
    printf("}\n");
    free(signal);
    return 0;
}

int main(int argc, char** argv)
{
    if (argc >= 5 && 0 == strcmp(argv[1], "cases"))
        return cmd_cases(argv[2], argv[3], argv[4]);
    if (argc >= 3 && 0 == strcmp(argv[1], "decode"))
        return cmd_decode(argc - 2, argv + 2);
    if (argc >= 2 && 0 == strcmp(argv[1], "waveform"))
        return cmd_waveform(argc - 2, argv + 2);
    fprintf(stderr, "usage: vectors cases CASES SECTIONS STATES | decode [-ft4] WAV... | waveform ...\n");
    return 2;
}
