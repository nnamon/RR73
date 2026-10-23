/**
 * Short names for the country file's entities, for narrow places such as a decode row. Big CTY
 * writes official or descriptive names ("Fed. Rep. of Germany", "Pr. Edward & Marion Is."); a
 * row has room for about 14 characters. Names longer than that get the short form operators use;
 * a few shorter official names do too ("Asiatic Turkey" is Turkey). Separate DXCC entities keep
 * separate names. docs/reference-data.md lists every change.
 *
 * Keys are the country file's names exactly. A name not listed shows as the country file writes
 * it, so a renamed entity shows its full name until this table follows.
 */

/** Longest display name a decode row shows whole at 375 pt, in characters. */
export const SHORT_NAME_MAX = 14;

/** Country file name to display name. */
export const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'Agalega & St. Brandon': 'Agalega',
  'Amsterdam & St. Paul Is.': 'Amsterdam Is.',
  'Andaman & Nicobar Is.': 'Andaman Is.',
  'Antigua & Barbuda': 'Antigua',
  'Ascension Island': 'Ascension',
  'Asiatic Turkey': 'Turkey',
  'Austral Islands': 'Austral Is.',
  'Baker & Howland Islands': 'Baker/Howland',
  'Balearic Islands': 'Balearic Is.',
  'Bosnia-Herzegovina': 'Bosnia',
  'British Virgin Islands': 'Br. Virgin Is.',
  'Brunei Darussalam': 'Brunei',
  'Central African Republic': 'Central Africa',
  'Central Kiribati': 'C. Kiribati',
  'Ceuta & Melilla': 'Ceuta/Melilla',
  'Chatham Islands': 'Chatham Is.',
  'Chesterfield Islands': 'Chesterfield',
  'Christmas Island': 'Christmas Is.',
  'Clipperton Island': 'Clipperton',
  'Cocos (Keeling) Islands': 'Cocos Keeling',
  'Dem. Rep. of the Congo': 'DR Congo',
  'Desecheo Island': 'Desecheo',
  'Dominican Republic': 'Dominican Rep.',
  'DPR of Korea': 'North Korea',
  'Eastern Kiribati': 'E. Kiribati',
  'Equatorial Guinea': 'Eq. Guinea',
  'European Turkey': 'Eur. Turkey',
  'Falkland Islands': 'Falklands',
  'Fed. Rep. of Germany': 'Germany',
  'Fernando de Noronha': 'F. de Noronha',
  'French Polynesia': 'Fr. Polynesia',
  'Galapagos Islands': 'Galapagos',
  'Glorioso Islands': 'Glorioso Is.',
  'Johnston Island': 'Johnston Is.',
  'Juan de Nova, Europa': 'Juan de Nova',
  'Juan Fernandez Islands': 'Juan Fernandez',
  'Kerguelen Islands': 'Kerguelen',
  'Kermadec Islands': 'Kermadec',
  'Kingdom of Eswatini': 'Eswatini',
  'Lakshadweep Islands': 'Lakshadweep',
  'Lord Howe Island': 'Lord Howe',
  'Macquarie Island': 'Macquarie',
  'Madeira Islands': 'Madeira',
  'Mariana Islands': 'Mariana Is.',
  'Marquesas Islands': 'Marquesas',
  'Marshall Islands': 'Marshall Is.',
  'N.Z. Subantarctic Is.': 'NZ Subantarctic',
  'North Cook Islands': 'North Cook Is.',
  'North Macedonia': 'N. Macedonia',
  'Northern Ireland': 'N. Ireland',
  'Palmyra & Jarvis Islands': 'Palmyra/Jarvis',
  'Pitcairn Island': 'Pitcairn',
  'Pr. Edward & Marion Is.': 'Marion Island',
  'Republic of Korea': 'South Korea',
  'Republic of Kosovo': 'Kosovo',
  'Republic of South Sudan': 'South Sudan',
  'Republic of the Congo': 'Congo',
  'Rodriguez Island': 'Rodriguez Is.',
  'Saba & St. Eustatius': 'Saba & Statia',
  'San Andres & Providencia': 'San Andres',
  'San Felix & San Ambrosio': 'San Felix',
  'Sao Tome & Principe': 'Sao Tome',
  'Scarborough Reef': 'Scarborough',
  'Shetland Islands': 'Shetland Is.',
  'Slovak Republic': 'Slovakia',
  'Solomon Islands': 'Solomon Is.',
  'South Cook Islands': 'South Cook Is.',
  'South Georgia Island': 'South Georgia',
  'South Orkney Islands': 'South Orkney',
  'South Sandwich Islands': 'South Sandwich',
  'South Shetland Islands': 'South Shetland',
  'Sov Mil Order of Malta': 'SMOM',
  'Spratly Islands': 'Spratly',
  'St. Kitts & Nevis': 'St. Kitts',
  'St. Paul Island': 'St. Paul Is.',
  'St. Peter & St. Paul': 'St. Peter/Paul',
  'St. Pierre & Miquelon': 'St. Pierre',
  'Temotu Province': 'Temotu',
  // lint-copy: off (the name as the country file spells it)
  'Timor - Leste': 'Timor-Leste',
  // lint-copy: on
  'Tokelau Islands': 'Tokelau',
  'Trindade & Martim Vaz': 'Trindade',
  'Trinidad & Tobago': 'Trinidad',
  'Tristan da Cunha & Gough': 'Tristan da Cunha',
  'Tromelin Island': 'Tromelin',
  'Turks & Caicos Islands': 'Turks & Caicos',
  'UK Base Areas on Cyprus': 'UK Base Areas',
  'United Arab Emirates': 'UAE',
  'United Nations HQ': 'UN HQ',
  'US Virgin Islands': 'US Virgin Is.',
  'Vienna Intl Ctr': 'Vienna Intl',
  'Wallis & Futuna Islands': 'Wallis/Futuna',
  'Western Kiribati': 'W. Kiribati',
};

/**
 * Display names longer than SHORT_NAME_MAX, kept because operators use no shorter form. They end
 * in an ellipsis on a narrow row.
 */
export const LONG_NAMES: ReadonlySet<string> = new Set(['European Russia', 'Franz Josef Land', 'Minami Torishima', 'NZ Subantarctic', 'Papua New Guinea', 'Tristan da Cunha']);

/** The name to show for a country file entity: "Germany" for "Fed. Rep. of Germany". */
export function displayName(name: string): string {
  return DISPLAY_NAMES[name] ?? name;
}
