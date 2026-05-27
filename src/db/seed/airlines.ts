/** ~40 carriers: sponsors of launch 13 + their key partners. */
export const AIRLINES = [
  // Star Alliance
  { iata: "UA", icao: "UAL", name: "United Airlines", allianceId: "STAR", countryIso2: "US" },
  { iata: "AC", icao: "ACA", name: "Air Canada", allianceId: "STAR", countryIso2: "CA" },
  { iata: "NH", icao: "ANA", name: "All Nippon Airways", allianceId: "STAR", countryIso2: "JP" },
  { iata: "LH", icao: "DLH", name: "Lufthansa", allianceId: "STAR", countryIso2: "DE" },
  { iata: "LX", icao: "SWR", name: "Swiss", allianceId: "STAR", countryIso2: "CH" },
  { iata: "OS", icao: "AUA", name: "Austrian", allianceId: "STAR", countryIso2: "AT" },
  { iata: "SN", icao: "BEL", name: "Brussels Airlines", allianceId: "STAR", countryIso2: "BE" },
  { iata: "TK", icao: "THY", name: "Turkish Airlines", allianceId: "STAR", countryIso2: "TR" },
  { iata: "AV", icao: "AVA", name: "Avianca", allianceId: "STAR", countryIso2: "CO" },
  { iata: "SQ", icao: "SIA", name: "Singapore Airlines", allianceId: "STAR", countryIso2: "SG" },
  { iata: "BR", icao: "EVA", name: "EVA Air", allianceId: "STAR", countryIso2: "TW" },
  { iata: "TG", icao: "THA", name: "Thai Airways", allianceId: "STAR", countryIso2: "TH" },
  { iata: "ET", icao: "ETH", name: "Ethiopian Airlines", allianceId: "STAR", countryIso2: "ET" },
  { iata: "OZ", icao: "AAR", name: "Asiana Airlines", allianceId: "STAR", countryIso2: "KR" },

  // Oneworld
  { iata: "AA", icao: "AAL", name: "American Airlines", allianceId: "ONE", countryIso2: "US" },
  { iata: "BA", icao: "BAW", name: "British Airways", allianceId: "ONE", countryIso2: "GB" },
  { iata: "CX", icao: "CPA", name: "Cathay Pacific", allianceId: "ONE", countryIso2: "HK" },
  { iata: "JL", icao: "JAL", name: "Japan Airlines", allianceId: "ONE", countryIso2: "JP" },
  { iata: "QR", icao: "QTR", name: "Qatar Airways", allianceId: "ONE", countryIso2: "QA" },
  { iata: "QF", icao: "QFA", name: "Qantas", allianceId: "ONE", countryIso2: "AU" },
  { iata: "AY", icao: "FIN", name: "Finnair", allianceId: "ONE", countryIso2: "FI" },
  { iata: "IB", icao: "IBE", name: "Iberia", allianceId: "ONE", countryIso2: "ES" },
  { iata: "AS", icao: "ASA", name: "Alaska Airlines", allianceId: "ONE", countryIso2: "US" },
  { iata: "MH", icao: "MAS", name: "Malaysia Airlines", allianceId: "ONE", countryIso2: "MY" },
  { iata: "RJ", icao: "RJA", name: "Royal Jordanian", allianceId: "ONE", countryIso2: "JO" },

  // SkyTeam
  { iata: "DL", icao: "DAL", name: "Delta Air Lines", allianceId: "SKY", countryIso2: "US" },
  { iata: "AF", icao: "AFR", name: "Air France", allianceId: "SKY", countryIso2: "FR" },
  { iata: "KL", icao: "KLM", name: "KLM", allianceId: "SKY", countryIso2: "NL" },
  { iata: "KE", icao: "KAL", name: "Korean Air", allianceId: "SKY", countryIso2: "KR" },
  { iata: "VS", icao: "VIR", name: "Virgin Atlantic", allianceId: "SKY", countryIso2: "GB" },
  { iata: "SU", icao: "AFL", name: "Aeroflot", allianceId: "SKY", countryIso2: "RU" },
  { iata: "MU", icao: "CES", name: "China Eastern", allianceId: "SKY", countryIso2: "CN" },
  { iata: "CI", icao: "CAL", name: "China Airlines", allianceId: "SKY", countryIso2: "TW" },
  { iata: "GA", icao: "GIA", name: "Garuda Indonesia", allianceId: "SKY", countryIso2: "ID" },

  // Unaligned
  { iata: "EK", icao: "UAE", name: "Emirates", allianceId: "NONE", countryIso2: "AE" },
  { iata: "EY", icao: "ETD", name: "Etihad", allianceId: "NONE", countryIso2: "AE" },
  { iata: "B6", icao: "JBU", name: "JetBlue", allianceId: "NONE", countryIso2: "US" },
  { iata: "WN", icao: "SWA", name: "Southwest Airlines", allianceId: "NONE", countryIso2: "US" },
  { iata: "FI", icao: "ICE", name: "Icelandair", allianceId: "NONE", countryIso2: "IS" },
] as const;
