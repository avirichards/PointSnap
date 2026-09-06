/**
 * Top ~150 hubs and large originating airports. Sized for the scaffold —
 * the full ~3000-airport OpenFlights set is a v1.1 sync target (see seed/README.md).
 *
 * Regions: NA, EU, AS-NE (NE Asia), AS-SE (SE Asia), AS-SC (South/Central Asia),
 *          ME, AF, OC, SA, CA (Central America / Caribbean).
 */

export interface AirportSeed {
  iata: string;
  icao?: string;
  name: string;
  city: string;
  countryIso2: string;
  region: string;
  latMicro: number;
  lonMicro: number;
  tzOlson: string;
}

const m = (deg: number) => Math.round(deg * 1_000_000);

export const AIRPORTS: AirportSeed[] = [
  // North America — US
  { iata: "JFK", icao: "KJFK", name: "John F. Kennedy International", city: "New York", countryIso2: "US", region: "NA", latMicro: m(40.6413), lonMicro: m(-73.7781), tzOlson: "America/New_York" },
  { iata: "EWR", icao: "KEWR", name: "Newark Liberty International", city: "Newark", countryIso2: "US", region: "NA", latMicro: m(40.6895), lonMicro: m(-74.1745), tzOlson: "America/New_York" },
  { iata: "LGA", icao: "KLGA", name: "LaGuardia", city: "New York", countryIso2: "US", region: "NA", latMicro: m(40.7769), lonMicro: m(-73.8740), tzOlson: "America/New_York" },
  { iata: "BOS", icao: "KBOS", name: "Boston Logan", city: "Boston", countryIso2: "US", region: "NA", latMicro: m(42.3656), lonMicro: m(-71.0096), tzOlson: "America/New_York" },
  { iata: "IAD", icao: "KIAD", name: "Washington Dulles", city: "Washington", countryIso2: "US", region: "NA", latMicro: m(38.9531), lonMicro: m(-77.4565), tzOlson: "America/New_York" },
  { iata: "DCA", icao: "KDCA", name: "Reagan National", city: "Washington", countryIso2: "US", region: "NA", latMicro: m(38.8512), lonMicro: m(-77.0402), tzOlson: "America/New_York" },
  { iata: "PHL", icao: "KPHL", name: "Philadelphia International", city: "Philadelphia", countryIso2: "US", region: "NA", latMicro: m(39.8744), lonMicro: m(-75.2424), tzOlson: "America/New_York" },
  { iata: "ATL", icao: "KATL", name: "Hartsfield-Jackson Atlanta", city: "Atlanta", countryIso2: "US", region: "NA", latMicro: m(33.6407), lonMicro: m(-84.4277), tzOlson: "America/New_York" },
  { iata: "MIA", icao: "KMIA", name: "Miami International", city: "Miami", countryIso2: "US", region: "NA", latMicro: m(25.7959), lonMicro: m(-80.2870), tzOlson: "America/New_York" },
  { iata: "MCO", icao: "KMCO", name: "Orlando International", city: "Orlando", countryIso2: "US", region: "NA", latMicro: m(28.4312), lonMicro: m(-81.3081), tzOlson: "America/New_York" },
  { iata: "FLL", icao: "KFLL", name: "Fort Lauderdale-Hollywood", city: "Fort Lauderdale", countryIso2: "US", region: "NA", latMicro: m(26.0726), lonMicro: m(-80.1527), tzOlson: "America/New_York" },
  { iata: "ORD", icao: "KORD", name: "Chicago O'Hare", city: "Chicago", countryIso2: "US", region: "NA", latMicro: m(41.9742), lonMicro: m(-87.9073), tzOlson: "America/Chicago" },
  { iata: "MDW", icao: "KMDW", name: "Chicago Midway", city: "Chicago", countryIso2: "US", region: "NA", latMicro: m(41.7868), lonMicro: m(-87.7522), tzOlson: "America/Chicago" },
  { iata: "DFW", icao: "KDFW", name: "Dallas/Fort Worth", city: "Dallas", countryIso2: "US", region: "NA", latMicro: m(32.8998), lonMicro: m(-97.0403), tzOlson: "America/Chicago" },
  { iata: "DAL", icao: "KDAL", name: "Dallas Love Field", city: "Dallas", countryIso2: "US", region: "NA", latMicro: m(32.8471), lonMicro: m(-96.8518), tzOlson: "America/Chicago" },
  { iata: "IAH", icao: "KIAH", name: "Houston Intercontinental", city: "Houston", countryIso2: "US", region: "NA", latMicro: m(29.9844), lonMicro: m(-95.3414), tzOlson: "America/Chicago" },
  // Airport/timezone reference: https://github.com/jpatokal/openflights/blob/master/data/airports.dat
  { iata: "AUS", icao: "KAUS", name: "Austin-Bergstrom International", city: "Austin", countryIso2: "US", region: "NA", latMicro: m(30.1945), lonMicro: m(-97.669899), tzOlson: "America/Chicago" },
  { iata: "DEN", icao: "KDEN", name: "Denver International", city: "Denver", countryIso2: "US", region: "NA", latMicro: m(39.8561), lonMicro: m(-104.6737), tzOlson: "America/Denver" },
  { iata: "MSP", icao: "KMSP", name: "Minneapolis-St. Paul", city: "Minneapolis", countryIso2: "US", region: "NA", latMicro: m(44.8848), lonMicro: m(-93.2223), tzOlson: "America/Chicago" },
  { iata: "DTW", icao: "KDTW", name: "Detroit Metropolitan", city: "Detroit", countryIso2: "US", region: "NA", latMicro: m(42.2124), lonMicro: m(-83.3534), tzOlson: "America/Detroit" },
  { iata: "CLT", icao: "KCLT", name: "Charlotte Douglas", city: "Charlotte", countryIso2: "US", region: "NA", latMicro: m(35.2140), lonMicro: m(-80.9431), tzOlson: "America/New_York" },
  { iata: "PHX", icao: "KPHX", name: "Phoenix Sky Harbor", city: "Phoenix", countryIso2: "US", region: "NA", latMicro: m(33.4342), lonMicro: m(-112.0117), tzOlson: "America/Phoenix" },
  { iata: "LAS", icao: "KLAS", name: "Las Vegas Harry Reid", city: "Las Vegas", countryIso2: "US", region: "NA", latMicro: m(36.0840), lonMicro: m(-115.1537), tzOlson: "America/Los_Angeles" },
  { iata: "SLC", icao: "KSLC", name: "Salt Lake City", city: "Salt Lake City", countryIso2: "US", region: "NA", latMicro: m(40.7884), lonMicro: m(-111.9778), tzOlson: "America/Denver" },
  { iata: "LAX", icao: "KLAX", name: "Los Angeles International", city: "Los Angeles", countryIso2: "US", region: "NA", latMicro: m(33.9416), lonMicro: m(-118.4085), tzOlson: "America/Los_Angeles" },
  { iata: "SFO", icao: "KSFO", name: "San Francisco International", city: "San Francisco", countryIso2: "US", region: "NA", latMicro: m(37.6213), lonMicro: m(-122.3790), tzOlson: "America/Los_Angeles" },
  { iata: "OAK", icao: "KOAK", name: "Oakland International", city: "Oakland", countryIso2: "US", region: "NA", latMicro: m(37.7213), lonMicro: m(-122.2208), tzOlson: "America/Los_Angeles" },
  { iata: "SJC", icao: "KSJC", name: "San Jose International", city: "San Jose", countryIso2: "US", region: "NA", latMicro: m(37.3639), lonMicro: m(-121.9289), tzOlson: "America/Los_Angeles" },
  { iata: "SAN", icao: "KSAN", name: "San Diego International", city: "San Diego", countryIso2: "US", region: "NA", latMicro: m(32.7338), lonMicro: m(-117.1933), tzOlson: "America/Los_Angeles" },
  { iata: "SEA", icao: "KSEA", name: "Seattle-Tacoma", city: "Seattle", countryIso2: "US", region: "NA", latMicro: m(47.4502), lonMicro: m(-122.3088), tzOlson: "America/Los_Angeles" },
  { iata: "PDX", icao: "KPDX", name: "Portland International", city: "Portland", countryIso2: "US", region: "NA", latMicro: m(45.5887), lonMicro: m(-122.5975), tzOlson: "America/Los_Angeles" },
  { iata: "ANC", icao: "PANC", name: "Anchorage", city: "Anchorage", countryIso2: "US", region: "NA", latMicro: m(61.1744), lonMicro: m(-149.9961), tzOlson: "America/Anchorage" },
  { iata: "HNL", icao: "PHNL", name: "Daniel K. Inouye Honolulu", city: "Honolulu", countryIso2: "US", region: "NA", latMicro: m(21.3187), lonMicro: m(-157.9224), tzOlson: "Pacific/Honolulu" },
  { iata: "OGG", icao: "PHOG", name: "Kahului", city: "Maui", countryIso2: "US", region: "NA", latMicro: m(20.8986), lonMicro: m(-156.4305), tzOlson: "Pacific/Honolulu" },
  { iata: "KOA", icao: "PHKO", name: "Ellison Onizuka Kona", city: "Kona", countryIso2: "US", region: "NA", latMicro: m(19.7388), lonMicro: m(-156.0456), tzOlson: "Pacific/Honolulu" },

  // North America — Canada / Mexico
  { iata: "YYZ", icao: "CYYZ", name: "Toronto Pearson", city: "Toronto", countryIso2: "CA", region: "NA", latMicro: m(43.6777), lonMicro: m(-79.6248), tzOlson: "America/Toronto" },
  { iata: "YUL", icao: "CYUL", name: "Montréal–Trudeau", city: "Montreal", countryIso2: "CA", region: "NA", latMicro: m(45.4706), lonMicro: m(-73.7408), tzOlson: "America/Montreal" },
  { iata: "YVR", icao: "CYVR", name: "Vancouver International", city: "Vancouver", countryIso2: "CA", region: "NA", latMicro: m(49.1947), lonMicro: m(-123.1839), tzOlson: "America/Vancouver" },
  { iata: "YYC", icao: "CYYC", name: "Calgary International", city: "Calgary", countryIso2: "CA", region: "NA", latMicro: m(51.1215), lonMicro: m(-114.0076), tzOlson: "America/Edmonton" },
  { iata: "YOW", icao: "CYOW", name: "Ottawa", city: "Ottawa", countryIso2: "CA", region: "NA", latMicro: m(45.3225), lonMicro: m(-75.6692), tzOlson: "America/Toronto" },
  { iata: "MEX", icao: "MMMX", name: "Mexico City International", city: "Mexico City", countryIso2: "MX", region: "NA", latMicro: m(19.4361), lonMicro: m(-99.0719), tzOlson: "America/Mexico_City" },
  { iata: "CUN", icao: "MMUN", name: "Cancún International", city: "Cancun", countryIso2: "MX", region: "CA", latMicro: m(21.0365), lonMicro: m(-86.8770), tzOlson: "America/Cancun" },

  // Europe
  { iata: "LHR", icao: "EGLL", name: "London Heathrow", city: "London", countryIso2: "GB", region: "EU", latMicro: m(51.4700), lonMicro: m(-0.4543), tzOlson: "Europe/London" },
  { iata: "LGW", icao: "EGKK", name: "London Gatwick", city: "London", countryIso2: "GB", region: "EU", latMicro: m(51.1537), lonMicro: m(-0.1821), tzOlson: "Europe/London" },
  { iata: "LCY", icao: "EGLC", name: "London City", city: "London", countryIso2: "GB", region: "EU", latMicro: m(51.5053), lonMicro: m(0.0553), tzOlson: "Europe/London" },
  { iata: "MAN", icao: "EGCC", name: "Manchester", city: "Manchester", countryIso2: "GB", region: "EU", latMicro: m(53.3537), lonMicro: m(-2.2750), tzOlson: "Europe/London" },
  { iata: "EDI", icao: "EGPH", name: "Edinburgh", city: "Edinburgh", countryIso2: "GB", region: "EU", latMicro: m(55.9500), lonMicro: m(-3.3725), tzOlson: "Europe/London" },
  { iata: "DUB", icao: "EIDW", name: "Dublin", city: "Dublin", countryIso2: "IE", region: "EU", latMicro: m(53.4213), lonMicro: m(-6.2700), tzOlson: "Europe/Dublin" },
  { iata: "CDG", icao: "LFPG", name: "Paris Charles de Gaulle", city: "Paris", countryIso2: "FR", region: "EU", latMicro: m(49.0097), lonMicro: m(2.5479), tzOlson: "Europe/Paris" },
  { iata: "ORY", icao: "LFPO", name: "Paris Orly", city: "Paris", countryIso2: "FR", region: "EU", latMicro: m(48.7233), lonMicro: m(2.3794), tzOlson: "Europe/Paris" },
  { iata: "NCE", icao: "LFMN", name: "Nice Côte d'Azur", city: "Nice", countryIso2: "FR", region: "EU", latMicro: m(43.6584), lonMicro: m(7.2159), tzOlson: "Europe/Paris" },
  { iata: "AMS", icao: "EHAM", name: "Amsterdam Schiphol", city: "Amsterdam", countryIso2: "NL", region: "EU", latMicro: m(52.3105), lonMicro: m(4.7683), tzOlson: "Europe/Amsterdam" },
  { iata: "BRU", icao: "EBBR", name: "Brussels", city: "Brussels", countryIso2: "BE", region: "EU", latMicro: m(50.9014), lonMicro: m(4.4844), tzOlson: "Europe/Brussels" },
  { iata: "FRA", icao: "EDDF", name: "Frankfurt", city: "Frankfurt", countryIso2: "DE", region: "EU", latMicro: m(50.0379), lonMicro: m(8.5622), tzOlson: "Europe/Berlin" },
  { iata: "MUC", icao: "EDDM", name: "Munich", city: "Munich", countryIso2: "DE", region: "EU", latMicro: m(48.3538), lonMicro: m(11.7861), tzOlson: "Europe/Berlin" },
  { iata: "BER", icao: "EDDB", name: "Berlin Brandenburg", city: "Berlin", countryIso2: "DE", region: "EU", latMicro: m(52.3667), lonMicro: m(13.5033), tzOlson: "Europe/Berlin" },
  { iata: "DUS", icao: "EDDL", name: "Düsseldorf", city: "Düsseldorf", countryIso2: "DE", region: "EU", latMicro: m(51.2895), lonMicro: m(6.7668), tzOlson: "Europe/Berlin" },
  { iata: "ZRH", icao: "LSZH", name: "Zürich", city: "Zürich", countryIso2: "CH", region: "EU", latMicro: m(47.4647), lonMicro: m(8.5492), tzOlson: "Europe/Zurich" },
  { iata: "GVA", icao: "LSGG", name: "Geneva", city: "Geneva", countryIso2: "CH", region: "EU", latMicro: m(46.2381), lonMicro: m(6.1090), tzOlson: "Europe/Zurich" },
  { iata: "VIE", icao: "LOWW", name: "Vienna", city: "Vienna", countryIso2: "AT", region: "EU", latMicro: m(48.1102), lonMicro: m(16.5697), tzOlson: "Europe/Vienna" },
  { iata: "ARN", icao: "ESSA", name: "Stockholm Arlanda", city: "Stockholm", countryIso2: "SE", region: "EU", latMicro: m(59.6519), lonMicro: m(17.9186), tzOlson: "Europe/Stockholm" },
  { iata: "CPH", icao: "EKCH", name: "Copenhagen", city: "Copenhagen", countryIso2: "DK", region: "EU", latMicro: m(55.6181), lonMicro: m(12.6561), tzOlson: "Europe/Copenhagen" },
  { iata: "OSL", icao: "ENGM", name: "Oslo Gardermoen", city: "Oslo", countryIso2: "NO", region: "EU", latMicro: m(60.1976), lonMicro: m(11.1004), tzOlson: "Europe/Oslo" },
  { iata: "HEL", icao: "EFHK", name: "Helsinki", city: "Helsinki", countryIso2: "FI", region: "EU", latMicro: m(60.3172), lonMicro: m(24.9633), tzOlson: "Europe/Helsinki" },
  { iata: "KEF", icao: "BIKF", name: "Keflavík", city: "Reykjavik", countryIso2: "IS", region: "EU", latMicro: m(63.9850), lonMicro: m(-22.6056), tzOlson: "Atlantic/Reykjavik" },
  { iata: "MAD", icao: "LEMD", name: "Madrid Barajas", city: "Madrid", countryIso2: "ES", region: "EU", latMicro: m(40.4719), lonMicro: m(-3.5626), tzOlson: "Europe/Madrid" },
  { iata: "BCN", icao: "LEBL", name: "Barcelona-El Prat", city: "Barcelona", countryIso2: "ES", region: "EU", latMicro: m(41.2974), lonMicro: m(2.0833), tzOlson: "Europe/Madrid" },
  { iata: "LIS", icao: "LPPT", name: "Lisbon", city: "Lisbon", countryIso2: "PT", region: "EU", latMicro: m(38.7813), lonMicro: m(-9.1357), tzOlson: "Europe/Lisbon" },
  { iata: "FCO", icao: "LIRF", name: "Rome Fiumicino", city: "Rome", countryIso2: "IT", region: "EU", latMicro: m(41.8003), lonMicro: m(12.2389), tzOlson: "Europe/Rome" },
  { iata: "MXP", icao: "LIMC", name: "Milan Malpensa", city: "Milan", countryIso2: "IT", region: "EU", latMicro: m(45.6306), lonMicro: m(8.7281), tzOlson: "Europe/Rome" },
  { iata: "VCE", icao: "LIPZ", name: "Venice Marco Polo", city: "Venice", countryIso2: "IT", region: "EU", latMicro: m(45.5050), lonMicro: m(12.3519), tzOlson: "Europe/Rome" },
  { iata: "ATH", icao: "LGAV", name: "Athens", city: "Athens", countryIso2: "GR", region: "EU", latMicro: m(37.9364), lonMicro: m(23.9445), tzOlson: "Europe/Athens" },
  { iata: "IST", icao: "LTFM", name: "Istanbul", city: "Istanbul", countryIso2: "TR", region: "EU", latMicro: m(41.2753), lonMicro: m(28.7519), tzOlson: "Europe/Istanbul" },
  { iata: "PRG", icao: "LKPR", name: "Prague Václav Havel", city: "Prague", countryIso2: "CZ", region: "EU", latMicro: m(50.1008), lonMicro: m(14.2632), tzOlson: "Europe/Prague" },
  { iata: "WAW", icao: "EPWA", name: "Warsaw Chopin", city: "Warsaw", countryIso2: "PL", region: "EU", latMicro: m(52.1657), lonMicro: m(20.9671), tzOlson: "Europe/Warsaw" },
  { iata: "BUD", icao: "LHBP", name: "Budapest", city: "Budapest", countryIso2: "HU", region: "EU", latMicro: m(47.4391), lonMicro: m(19.2552), tzOlson: "Europe/Budapest" },

  // Asia — NE
  { iata: "NRT", icao: "RJAA", name: "Tokyo Narita", city: "Tokyo", countryIso2: "JP", region: "AS-NE", latMicro: m(35.7654), lonMicro: m(140.3858), tzOlson: "Asia/Tokyo" },
  { iata: "HND", icao: "RJTT", name: "Tokyo Haneda", city: "Tokyo", countryIso2: "JP", region: "AS-NE", latMicro: m(35.5494), lonMicro: m(139.7798), tzOlson: "Asia/Tokyo" },
  { iata: "KIX", icao: "RJBB", name: "Kansai (Osaka)", city: "Osaka", countryIso2: "JP", region: "AS-NE", latMicro: m(34.4347), lonMicro: m(135.2440), tzOlson: "Asia/Tokyo" },
  { iata: "NGO", icao: "RJGG", name: "Chubu Centrair", city: "Nagoya", countryIso2: "JP", region: "AS-NE", latMicro: m(34.8584), lonMicro: m(136.8054), tzOlson: "Asia/Tokyo" },
  { iata: "FUK", icao: "RJFF", name: "Fukuoka", city: "Fukuoka", countryIso2: "JP", region: "AS-NE", latMicro: m(33.5860), lonMicro: m(130.4506), tzOlson: "Asia/Tokyo" },
  { iata: "OKA", icao: "ROAH", name: "Naha (Okinawa)", city: "Naha", countryIso2: "JP", region: "AS-NE", latMicro: m(26.1958), lonMicro: m(127.6458), tzOlson: "Asia/Tokyo" },
  { iata: "ICN", icao: "RKSI", name: "Incheon", city: "Seoul", countryIso2: "KR", region: "AS-NE", latMicro: m(37.4602), lonMicro: m(126.4407), tzOlson: "Asia/Seoul" },
  { iata: "GMP", icao: "RKSS", name: "Gimpo", city: "Seoul", countryIso2: "KR", region: "AS-NE", latMicro: m(37.5587), lonMicro: m(126.7906), tzOlson: "Asia/Seoul" },
  { iata: "PVG", icao: "ZSPD", name: "Shanghai Pudong", city: "Shanghai", countryIso2: "CN", region: "AS-NE", latMicro: m(31.1443), lonMicro: m(121.8083), tzOlson: "Asia/Shanghai" },
  { iata: "SHA", icao: "ZSSS", name: "Shanghai Hongqiao", city: "Shanghai", countryIso2: "CN", region: "AS-NE", latMicro: m(31.1979), lonMicro: m(121.3363), tzOlson: "Asia/Shanghai" },
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital", city: "Beijing", countryIso2: "CN", region: "AS-NE", latMicro: m(40.0801), lonMicro: m(116.5846), tzOlson: "Asia/Shanghai" },
  { iata: "PKX", icao: "ZBAD", name: "Beijing Daxing", city: "Beijing", countryIso2: "CN", region: "AS-NE", latMicro: m(39.5098), lonMicro: m(116.4108), tzOlson: "Asia/Shanghai" },
  { iata: "CAN", icao: "ZGGG", name: "Guangzhou Baiyun", city: "Guangzhou", countryIso2: "CN", region: "AS-NE", latMicro: m(23.3924), lonMicro: m(113.2988), tzOlson: "Asia/Shanghai" },
  { iata: "HKG", icao: "VHHH", name: "Hong Kong International", city: "Hong Kong", countryIso2: "HK", region: "AS-NE", latMicro: m(22.3080), lonMicro: m(113.9185), tzOlson: "Asia/Hong_Kong" },
  { iata: "TPE", icao: "RCTP", name: "Taipei Taoyuan", city: "Taipei", countryIso2: "TW", region: "AS-NE", latMicro: m(25.0797), lonMicro: m(121.2342), tzOlson: "Asia/Taipei" },
  { iata: "TSA", icao: "RCSS", name: "Taipei Songshan", city: "Taipei", countryIso2: "TW", region: "AS-NE", latMicro: m(25.0697), lonMicro: m(121.5519), tzOlson: "Asia/Taipei" },

  // Asia — SE
  { iata: "SIN", icao: "WSSS", name: "Singapore Changi", city: "Singapore", countryIso2: "SG", region: "AS-SE", latMicro: m(1.3644), lonMicro: m(103.9915), tzOlson: "Asia/Singapore" },
  { iata: "KUL", icao: "WMKK", name: "Kuala Lumpur International", city: "Kuala Lumpur", countryIso2: "MY", region: "AS-SE", latMicro: m(2.7456), lonMicro: m(101.7099), tzOlson: "Asia/Kuala_Lumpur" },
  { iata: "BKK", icao: "VTBS", name: "Bangkok Suvarnabhumi", city: "Bangkok", countryIso2: "TH", region: "AS-SE", latMicro: m(13.6900), lonMicro: m(100.7501), tzOlson: "Asia/Bangkok" },
  { iata: "DMK", icao: "VTBD", name: "Bangkok Don Mueang", city: "Bangkok", countryIso2: "TH", region: "AS-SE", latMicro: m(13.9126), lonMicro: m(100.6068), tzOlson: "Asia/Bangkok" },
  { iata: "HKT", icao: "VTSP", name: "Phuket", city: "Phuket", countryIso2: "TH", region: "AS-SE", latMicro: m(8.1132), lonMicro: m(98.3169), tzOlson: "Asia/Bangkok" },
  { iata: "SGN", icao: "VVTS", name: "Tan Son Nhat (HCMC)", city: "Ho Chi Minh City", countryIso2: "VN", region: "AS-SE", latMicro: m(10.8188), lonMicro: m(106.6520), tzOlson: "Asia/Ho_Chi_Minh" },
  { iata: "HAN", icao: "VVNB", name: "Noi Bai (Hanoi)", city: "Hanoi", countryIso2: "VN", region: "AS-SE", latMicro: m(21.2212), lonMicro: m(105.8072), tzOlson: "Asia/Ho_Chi_Minh" },
  { iata: "MNL", icao: "RPLL", name: "Manila Ninoy Aquino", city: "Manila", countryIso2: "PH", region: "AS-SE", latMicro: m(14.5086), lonMicro: m(121.0198), tzOlson: "Asia/Manila" },
  { iata: "CGK", icao: "WIII", name: "Jakarta Soekarno-Hatta", city: "Jakarta", countryIso2: "ID", region: "AS-SE", latMicro: m(-6.1256), lonMicro: m(106.6559), tzOlson: "Asia/Jakarta" },
  { iata: "DPS", icao: "WADD", name: "Bali Denpasar", city: "Bali", countryIso2: "ID", region: "AS-SE", latMicro: m(-8.7482), lonMicro: m(115.1671), tzOlson: "Asia/Makassar" },

  // Asia — SC
  { iata: "DEL", icao: "VIDP", name: "Delhi Indira Gandhi", city: "Delhi", countryIso2: "IN", region: "AS-SC", latMicro: m(28.5562), lonMicro: m(77.1000), tzOlson: "Asia/Kolkata" },
  { iata: "BOM", icao: "VABB", name: "Mumbai", city: "Mumbai", countryIso2: "IN", region: "AS-SC", latMicro: m(19.0896), lonMicro: m(72.8656), tzOlson: "Asia/Kolkata" },
  { iata: "BLR", icao: "VOBL", name: "Bengaluru Kempegowda", city: "Bengaluru", countryIso2: "IN", region: "AS-SC", latMicro: m(13.1986), lonMicro: m(77.7066), tzOlson: "Asia/Kolkata" },
  { iata: "MAA", icao: "VOMM", name: "Chennai", city: "Chennai", countryIso2: "IN", region: "AS-SC", latMicro: m(13.0827), lonMicro: m(80.2707), tzOlson: "Asia/Kolkata" },
  { iata: "HYD", icao: "VOHS", name: "Hyderabad", city: "Hyderabad", countryIso2: "IN", region: "AS-SC", latMicro: m(17.2403), lonMicro: m(78.4294), tzOlson: "Asia/Kolkata" },

  // Middle East
  { iata: "DXB", icao: "OMDB", name: "Dubai International", city: "Dubai", countryIso2: "AE", region: "ME", latMicro: m(25.2532), lonMicro: m(55.3657), tzOlson: "Asia/Dubai" },
  { iata: "AUH", icao: "OMAA", name: "Abu Dhabi", city: "Abu Dhabi", countryIso2: "AE", region: "ME", latMicro: m(24.4330), lonMicro: m(54.6511), tzOlson: "Asia/Dubai" },
  { iata: "DOH", icao: "OTHH", name: "Doha Hamad", city: "Doha", countryIso2: "QA", region: "ME", latMicro: m(25.2611), lonMicro: m(51.6138), tzOlson: "Asia/Qatar" },
  { iata: "AMM", icao: "OJAI", name: "Amman Queen Alia", city: "Amman", countryIso2: "JO", region: "ME", latMicro: m(31.7226), lonMicro: m(35.9933), tzOlson: "Asia/Amman" },
  { iata: "TLV", icao: "LLBG", name: "Tel Aviv Ben Gurion", city: "Tel Aviv", countryIso2: "IL", region: "ME", latMicro: m(32.0114), lonMicro: m(34.8867), tzOlson: "Asia/Jerusalem" },

  // Africa
  { iata: "ADD", icao: "HAAB", name: "Addis Ababa Bole", city: "Addis Ababa", countryIso2: "ET", region: "AF", latMicro: m(8.9778), lonMicro: m(38.7993), tzOlson: "Africa/Addis_Ababa" },
  { iata: "JNB", icao: "FAOR", name: "Johannesburg O.R. Tambo", city: "Johannesburg", countryIso2: "ZA", region: "AF", latMicro: m(-26.1392), lonMicro: m(28.2460), tzOlson: "Africa/Johannesburg" },
  { iata: "CPT", icao: "FACT", name: "Cape Town", city: "Cape Town", countryIso2: "ZA", region: "AF", latMicro: m(-33.9690), lonMicro: m(18.5970), tzOlson: "Africa/Johannesburg" },
  { iata: "CAI", icao: "HECA", name: "Cairo International", city: "Cairo", countryIso2: "EG", region: "AF", latMicro: m(30.1219), lonMicro: m(31.4056), tzOlson: "Africa/Cairo" },
  { iata: "NBO", icao: "HKJK", name: "Nairobi Jomo Kenyatta", city: "Nairobi", countryIso2: "KE", region: "AF", latMicro: m(-1.3192), lonMicro: m(36.9278), tzOlson: "Africa/Nairobi" },
  { iata: "MRU", icao: "FIMP", name: "Mauritius SSR", city: "Port Louis", countryIso2: "MU", region: "AF", latMicro: m(-20.4302), lonMicro: m(57.6836), tzOlson: "Indian/Mauritius" },

  // Oceania
  { iata: "SYD", icao: "YSSY", name: "Sydney Kingsford Smith", city: "Sydney", countryIso2: "AU", region: "OC", latMicro: m(-33.9399), lonMicro: m(151.1753), tzOlson: "Australia/Sydney" },
  { iata: "MEL", icao: "YMML", name: "Melbourne Tullamarine", city: "Melbourne", countryIso2: "AU", region: "OC", latMicro: m(-37.6690), lonMicro: m(144.8410), tzOlson: "Australia/Melbourne" },
  { iata: "BNE", icao: "YBBN", name: "Brisbane", city: "Brisbane", countryIso2: "AU", region: "OC", latMicro: m(-27.3942), lonMicro: m(153.1218), tzOlson: "Australia/Brisbane" },
  { iata: "PER", icao: "YPPH", name: "Perth", city: "Perth", countryIso2: "AU", region: "OC", latMicro: m(-31.9385), lonMicro: m(115.9672), tzOlson: "Australia/Perth" },
  { iata: "AKL", icao: "NZAA", name: "Auckland", city: "Auckland", countryIso2: "NZ", region: "OC", latMicro: m(-37.0082), lonMicro: m(174.7917), tzOlson: "Pacific/Auckland" },
  { iata: "NAN", icao: "NFFN", name: "Nadi", city: "Nadi", countryIso2: "FJ", region: "OC", latMicro: m(-17.7554), lonMicro: m(177.4434), tzOlson: "Pacific/Fiji" },

  // South America
  { iata: "GRU", icao: "SBGR", name: "São Paulo Guarulhos", city: "São Paulo", countryIso2: "BR", region: "SA", latMicro: m(-23.4356), lonMicro: m(-46.4731), tzOlson: "America/Sao_Paulo" },
  { iata: "GIG", icao: "SBGL", name: "Rio Galeão", city: "Rio de Janeiro", countryIso2: "BR", region: "SA", latMicro: m(-22.8099), lonMicro: m(-43.2505), tzOlson: "America/Sao_Paulo" },
  { iata: "EZE", icao: "SAEZ", name: "Buenos Aires Ezeiza", city: "Buenos Aires", countryIso2: "AR", region: "SA", latMicro: m(-34.8222), lonMicro: m(-58.5358), tzOlson: "America/Argentina/Buenos_Aires" },
  { iata: "SCL", icao: "SCEL", name: "Santiago", city: "Santiago", countryIso2: "CL", region: "SA", latMicro: m(-33.3930), lonMicro: m(-70.7858), tzOlson: "America/Santiago" },
  { iata: "BOG", icao: "SKBO", name: "Bogotá El Dorado", city: "Bogotá", countryIso2: "CO", region: "SA", latMicro: m(4.7016), lonMicro: m(-74.1469), tzOlson: "America/Bogota" },
  { iata: "LIM", icao: "SPJC", name: "Lima Jorge Chávez", city: "Lima", countryIso2: "PE", region: "SA", latMicro: m(-12.0219), lonMicro: m(-77.1144), tzOlson: "America/Lima" },

  // Central America / Caribbean
  { iata: "PTY", icao: "MPTO", name: "Panama Tocumen", city: "Panama City", countryIso2: "PA", region: "CA", latMicro: m(9.0714), lonMicro: m(-79.3835), tzOlson: "America/Panama" },
  { iata: "SJO", icao: "MROC", name: "San José Juan Santamaria", city: "San José", countryIso2: "CR", region: "CA", latMicro: m(9.9939), lonMicro: m(-84.2088), tzOlson: "America/Costa_Rica" },
  { iata: "NAS", icao: "MYNN", name: "Nassau Lynden Pindling", city: "Nassau", countryIso2: "BS", region: "CA", latMicro: m(25.0390), lonMicro: m(-77.4663), tzOlson: "America/Nassau" },
];
