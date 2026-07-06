import type { AirportMetadata, Region } from "./types";
import { HKG_AIRPORT } from "./geo";

const AIRPORTS: AirportMetadata[] = [
  HKG_AIRPORT,
  { iata: "MFM", icao: "VMMC", name: "Macau International Airport", city: "Macau", country: "Macau", region: "Greater China", lat: 22.1496, lon: 113.5916 },
  { iata: "TPE", icao: "RCTP", name: "Taiwan Taoyuan International Airport", city: "Taipei", country: "Taiwan", region: "Greater China", lat: 25.0797, lon: 121.2342 },
  { iata: "TSA", icao: "RCSS", name: "Taipei Songshan Airport", city: "Taipei", country: "Taiwan", region: "Greater China", lat: 25.0694, lon: 121.5525 },
  { iata: "KHH", icao: "RCKH", name: "Kaohsiung International Airport", city: "Kaohsiung", country: "Taiwan", region: "Greater China", lat: 22.5771, lon: 120.3500 },
  { iata: "CAN", icao: "ZGGG", name: "Guangzhou Baiyun International Airport", city: "Guangzhou", country: "China", region: "Greater China", lat: 23.3924, lon: 113.2988 },
  { iata: "SZX", icao: "ZGSZ", name: "Shenzhen Bao'an International Airport", city: "Shenzhen", country: "China", region: "Greater China", lat: 22.6393, lon: 113.8107 },
  { iata: "PVG", icao: "ZSPD", name: "Shanghai Pudong International Airport", city: "Shanghai", country: "China", region: "Greater China", lat: 31.1443, lon: 121.8083 },
  { iata: "SHA", icao: "ZSSS", name: "Shanghai Hongqiao International Airport", city: "Shanghai", country: "China", region: "Greater China", lat: 31.1979, lon: 121.3363 },
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", city: "Beijing", country: "China", region: "Greater China", lat: 40.0801, lon: 116.5846 },
  { iata: "PKX", icao: "ZBAD", name: "Beijing Daxing International Airport", city: "Beijing", country: "China", region: "Greater China", lat: 39.5099, lon: 116.4109 },
  { iata: "XMN", icao: "ZSAM", name: "Xiamen Gaoqi International Airport", city: "Xiamen", country: "China", region: "Greater China", lat: 24.5440, lon: 118.1277 },
  { iata: "FOC", icao: "ZSFZ", name: "Fuzhou Changle International Airport", city: "Fuzhou", country: "China", region: "Greater China", lat: 25.9351, lon: 119.6633 },
  { iata: "HGH", icao: "ZSHC", name: "Hangzhou Xiaoshan International Airport", city: "Hangzhou", country: "China", region: "Greater China", lat: 30.2295, lon: 120.4345 },
  { iata: "NKG", icao: "ZSNJ", name: "Nanjing Lukou International Airport", city: "Nanjing", country: "China", region: "Greater China", lat: 31.7420, lon: 118.8620 },
  { iata: "NGB", icao: "ZSNB", name: "Ningbo Lishe International Airport", city: "Ningbo", country: "China", region: "Greater China", lat: 29.8267, lon: 121.4619 },
  { iata: "TAO", icao: "ZSQD", name: "Qingdao Jiaodong International Airport", city: "Qingdao", country: "China", region: "Greater China", lat: 36.3619, lon: 120.0882 },
  { iata: "WUH", icao: "ZHHH", name: "Wuhan Tianhe International Airport", city: "Wuhan", country: "China", region: "Greater China", lat: 30.7838, lon: 114.2081 },
  { iata: "CSX", icao: "ZGHA", name: "Changsha Huanghua International Airport", city: "Changsha", country: "China", region: "Greater China", lat: 28.1892, lon: 113.2200 },
  { iata: "CGO", icao: "ZHCC", name: "Zhengzhou Xinzheng International Airport", city: "Zhengzhou", country: "China", region: "Greater China", lat: 34.5197, lon: 113.8409 },
  { iata: "CKG", icao: "ZUCK", name: "Chongqing Jiangbei International Airport", city: "Chongqing", country: "China", region: "Greater China", lat: 29.7192, lon: 106.6417 },
  { iata: "CTU", icao: "ZUUU", name: "Chengdu Shuangliu International Airport", city: "Chengdu", country: "China", region: "Greater China", lat: 30.5785, lon: 103.9471 },
  { iata: "TFU", icao: "ZUTF", name: "Chengdu Tianfu International Airport", city: "Chengdu", country: "China", region: "Greater China", lat: 30.3125, lon: 104.4413 },
  { iata: "XIY", icao: "ZLXY", name: "Xi'an Xianyang International Airport", city: "Xi'an", country: "China", region: "Greater China", lat: 34.4471, lon: 108.7516 },
  { iata: "KMG", icao: "ZPPP", name: "Kunming Changshui International Airport", city: "Kunming", country: "China", region: "Greater China", lat: 25.1019, lon: 102.9292 },
  { iata: "HAK", icao: "ZJHK", name: "Haikou Meilan International Airport", city: "Haikou", country: "China", region: "Greater China", lat: 19.9349, lon: 110.4589 },
  { iata: "SYX", icao: "ZJSY", name: "Sanya Phoenix International Airport", city: "Sanya", country: "China", region: "Greater China", lat: 18.3029, lon: 109.4123 },
  { iata: "NNG", icao: "ZGNN", name: "Nanning Wuxu International Airport", city: "Nanning", country: "China", region: "Greater China", lat: 22.6083, lon: 108.1725 },
  { iata: "BKK", icao: "VTBS", name: "Suvarnabhumi Airport", city: "Bangkok", country: "Thailand", region: "Asia", lat: 13.6900, lon: 100.7501 },
  { iata: "DMK", icao: "VTBD", name: "Don Mueang International Airport", city: "Bangkok", country: "Thailand", region: "Asia", lat: 13.9126, lon: 100.6070 },
  { iata: "HKT", icao: "VTSP", name: "Phuket International Airport", city: "Phuket", country: "Thailand", region: "Asia", lat: 8.1132, lon: 98.3169 },
  { iata: "CNX", icao: "VTCC", name: "Chiang Mai International Airport", city: "Chiang Mai", country: "Thailand", region: "Asia", lat: 18.7668, lon: 98.9626 },
  { iata: "SIN", icao: "WSSS", name: "Singapore Changi Airport", city: "Singapore", country: "Singapore", region: "Asia", lat: 1.3644, lon: 103.9915 },
  { iata: "KUL", icao: "WMKK", name: "Kuala Lumpur International Airport", city: "Kuala Lumpur", country: "Malaysia", region: "Asia", lat: 2.7456, lon: 101.7072 },
  { iata: "PEN", icao: "WMKP", name: "Penang International Airport", city: "Penang", country: "Malaysia", region: "Asia", lat: 5.2971, lon: 100.2769 },
  { iata: "CGK", icao: "WIII", name: "Soekarno-Hatta International Airport", city: "Jakarta", country: "Indonesia", region: "Asia", lat: -6.1256, lon: 106.6559 },
  { iata: "DPS", icao: "WADD", name: "Ngurah Rai International Airport", city: "Denpasar", country: "Indonesia", region: "Asia", lat: -8.7482, lon: 115.1672 },
  { iata: "MNL", icao: "RPLL", name: "Ninoy Aquino International Airport", city: "Manila", country: "Philippines", region: "Asia", lat: 14.5086, lon: 121.0197 },
  { iata: "CEB", icao: "RPVM", name: "Mactan-Cebu International Airport", city: "Cebu", country: "Philippines", region: "Asia", lat: 10.3075, lon: 123.9794 },
  { iata: "HAN", icao: "VVNB", name: "Noi Bai International Airport", city: "Hanoi", country: "Vietnam", region: "Asia", lat: 21.2212, lon: 105.8072 },
  { iata: "SGN", icao: "VVTS", name: "Tan Son Nhat International Airport", city: "Ho Chi Minh City", country: "Vietnam", region: "Asia", lat: 10.8188, lon: 106.6520 },
  { iata: "PQC", icao: "VVPQ", name: "Phu Quoc International Airport", city: "Phu Quoc", country: "Vietnam", region: "Asia", lat: 10.1698, lon: 103.9931 },
  { iata: "DAD", icao: "VVDN", name: "Da Nang International Airport", city: "Da Nang", country: "Vietnam", region: "Asia", lat: 16.0439, lon: 108.1994 },
  { iata: "KTI", icao: "VDKT", name: "Kratie Airport", city: "Kratie", country: "Cambodia", region: "Asia", lat: 12.4880, lon: 106.0550 },
  { iata: "PNH", icao: "VDPP", name: "Phnom Penh International Airport", city: "Phnom Penh", country: "Cambodia", region: "Asia", lat: 11.5466, lon: 104.8441 },
  { iata: "REP", icao: "VDSR", name: "Siem Reap International Airport", city: "Siem Reap", country: "Cambodia", region: "Asia", lat: 13.4107, lon: 103.8128 },
  { iata: "ICN", icao: "RKSI", name: "Incheon International Airport", city: "Seoul", country: "South Korea", region: "Asia", lat: 37.4602, lon: 126.4407 },
  { iata: "GMP", icao: "RKSS", name: "Gimpo International Airport", city: "Seoul", country: "South Korea", region: "Asia", lat: 37.5583, lon: 126.7906 },
  { iata: "PUS", icao: "RKPK", name: "Gimhae International Airport", city: "Busan", country: "South Korea", region: "Asia", lat: 35.1795, lon: 128.9382 },
  { iata: "NRT", icao: "RJAA", name: "Narita International Airport", city: "Tokyo", country: "Japan", region: "Asia", lat: 35.7647, lon: 140.3864 },
  { iata: "HND", icao: "RJTT", name: "Tokyo Haneda Airport", city: "Tokyo", country: "Japan", region: "Asia", lat: 35.5494, lon: 139.7798 },
  { iata: "KIX", icao: "RJBB", name: "Kansai International Airport", city: "Osaka", country: "Japan", region: "Asia", lat: 34.4273, lon: 135.2440 },
  { iata: "ITM", icao: "RJOO", name: "Osaka International Airport", city: "Osaka", country: "Japan", region: "Asia", lat: 34.7855, lon: 135.4382 },
  { iata: "NGO", icao: "RJGG", name: "Chubu Centrair International Airport", city: "Nagoya", country: "Japan", region: "Asia", lat: 34.8584, lon: 136.8054 },
  { iata: "FUK", icao: "RJFF", name: "Fukuoka Airport", city: "Fukuoka", country: "Japan", region: "Asia", lat: 33.5859, lon: 130.4507 },
  { iata: "OKA", icao: "ROAH", name: "Naha Airport", city: "Okinawa", country: "Japan", region: "Asia", lat: 26.1958, lon: 127.6459 },
  { iata: "CTS", icao: "RJCC", name: "New Chitose Airport", city: "Sapporo", country: "Japan", region: "Asia", lat: 42.7752, lon: 141.6923 },
  { iata: "DEL", icao: "VIDP", name: "Indira Gandhi International Airport", city: "Delhi", country: "India", region: "Asia", lat: 28.5562, lon: 77.1000 },
  { iata: "BOM", icao: "VABB", name: "Chhatrapati Shivaji Maharaj International Airport", city: "Mumbai", country: "India", region: "Asia", lat: 19.0896, lon: 72.8656 },
  { iata: "BLR", icao: "VOBL", name: "Kempegowda International Airport", city: "Bengaluru", country: "India", region: "Asia", lat: 13.1986, lon: 77.7066 },
  { iata: "MAA", icao: "VOMM", name: "Chennai International Airport", city: "Chennai", country: "India", region: "Asia", lat: 12.9941, lon: 80.1709 },
  { iata: "HYD", icao: "VOHS", name: "Rajiv Gandhi International Airport", city: "Hyderabad", country: "India", region: "Asia", lat: 17.2403, lon: 78.4294 },
  { iata: "CCU", icao: "VECC", name: "Netaji Subhas Chandra Bose International Airport", city: "Kolkata", country: "India", region: "Asia", lat: 22.6547, lon: 88.4467 },
  { iata: "DAC", icao: "VGHS", name: "Hazrat Shahjalal International Airport", city: "Dhaka", country: "Bangladesh", region: "Asia", lat: 23.8433, lon: 90.3978 },
  { iata: "KTM", icao: "VNKT", name: "Tribhuvan International Airport", city: "Kathmandu", country: "Nepal", region: "Asia", lat: 27.6966, lon: 85.3591 },
  { iata: "CMB", icao: "VCBI", name: "Bandaranaike International Airport", city: "Colombo", country: "Sri Lanka", region: "Asia", lat: 7.1808, lon: 79.8841 },
  { iata: "MLE", icao: "VRMM", name: "Velana International Airport", city: "Male", country: "Maldives", region: "Asia", lat: 4.1918, lon: 73.5291 },
  { iata: "KHI", icao: "OPKC", name: "Jinnah International Airport", city: "Karachi", country: "Pakistan", region: "Asia", lat: 24.9065, lon: 67.1608 },
  { iata: "LHE", icao: "OPLA", name: "Allama Iqbal International Airport", city: "Lahore", country: "Pakistan", region: "Asia", lat: 31.5216, lon: 74.4036 },
  { iata: "ISB", icao: "OPIS", name: "Islamabad International Airport", city: "Islamabad", country: "Pakistan", region: "Asia", lat: 33.5490, lon: 72.8257 },
  { iata: "DXB", icao: "OMDB", name: "Dubai International Airport", city: "Dubai", country: "United Arab Emirates", region: "Middle East", lat: 25.2532, lon: 55.3657 },
  { iata: "DWC", icao: "OMDW", name: "Al Maktoum International Airport", city: "Dubai", country: "United Arab Emirates", region: "Middle East", lat: 24.8964, lon: 55.1614 },
  { iata: "AUH", icao: "OMAA", name: "Zayed International Airport", city: "Abu Dhabi", country: "United Arab Emirates", region: "Middle East", lat: 24.4330, lon: 54.6511 },
  { iata: "DOH", icao: "OTHH", name: "Hamad International Airport", city: "Doha", country: "Qatar", region: "Middle East", lat: 25.2731, lon: 51.6081 },
  { iata: "BAH", icao: "OBBI", name: "Bahrain International Airport", city: "Manama", country: "Bahrain", region: "Middle East", lat: 26.2708, lon: 50.6336 },
  { iata: "KWI", icao: "OKKK", name: "Kuwait International Airport", city: "Kuwait City", country: "Kuwait", region: "Middle East", lat: 29.2266, lon: 47.9689 },
  { iata: "RUH", icao: "OERK", name: "King Khalid International Airport", city: "Riyadh", country: "Saudi Arabia", region: "Middle East", lat: 24.9576, lon: 46.6988 },
  { iata: "JED", icao: "OEJN", name: "King Abdulaziz International Airport", city: "Jeddah", country: "Saudi Arabia", region: "Middle East", lat: 21.6796, lon: 39.1565 },
  { iata: "DMM", icao: "OEDF", name: "King Fahd International Airport", city: "Dammam", country: "Saudi Arabia", region: "Middle East", lat: 26.4712, lon: 49.7979 },
  { iata: "TLV", icao: "LLBG", name: "Ben Gurion Airport", city: "Tel Aviv", country: "Israel", region: "Middle East", lat: 32.0114, lon: 34.8867 },
  { iata: "IST", icao: "LTFM", name: "Istanbul Airport", city: "Istanbul", country: "Turkiye", region: "Europe", lat: 41.2608, lon: 28.7419 },
  { iata: "LHR", icao: "EGLL", name: "London Heathrow Airport", city: "London", country: "United Kingdom", region: "Europe", lat: 51.4700, lon: -0.4543 },
  { iata: "LGW", icao: "EGKK", name: "London Gatwick Airport", city: "London", country: "United Kingdom", region: "Europe", lat: 51.1537, lon: -0.1821 },
  { iata: "CDG", icao: "LFPG", name: "Charles de Gaulle Airport", city: "Paris", country: "France", region: "Europe", lat: 49.0097, lon: 2.5479 },
  { iata: "AMS", icao: "EHAM", name: "Amsterdam Airport Schiphol", city: "Amsterdam", country: "Netherlands", region: "Europe", lat: 52.3105, lon: 4.7683 },
  { iata: "FRA", icao: "EDDF", name: "Frankfurt Airport", city: "Frankfurt", country: "Germany", region: "Europe", lat: 50.0379, lon: 8.5622 },
  { iata: "MUC", icao: "EDDM", name: "Munich Airport", city: "Munich", country: "Germany", region: "Europe", lat: 48.3538, lon: 11.7861 },
  { iata: "ZRH", icao: "LSZH", name: "Zurich Airport", city: "Zurich", country: "Switzerland", region: "Europe", lat: 47.4581, lon: 8.5555 },
  { iata: "FCO", icao: "LIRF", name: "Leonardo da Vinci-Fiumicino Airport", city: "Rome", country: "Italy", region: "Europe", lat: 41.8003, lon: 12.2389 },
  { iata: "MXP", icao: "LIMC", name: "Milan Malpensa Airport", city: "Milan", country: "Italy", region: "Europe", lat: 45.6306, lon: 8.7281 },
  { iata: "MAD", icao: "LEMD", name: "Adolfo Suarez Madrid-Barajas Airport", city: "Madrid", country: "Spain", region: "Europe", lat: 40.4983, lon: -3.5676 },
  { iata: "BCN", icao: "LEBL", name: "Barcelona-El Prat Airport", city: "Barcelona", country: "Spain", region: "Europe", lat: 41.2974, lon: 2.0833 },
  { iata: "HEL", icao: "EFHK", name: "Helsinki Airport", city: "Helsinki", country: "Finland", region: "Europe", lat: 60.3172, lon: 24.9633 },
  { iata: "CPH", icao: "EKCH", name: "Copenhagen Airport", city: "Copenhagen", country: "Denmark", region: "Europe", lat: 55.6180, lon: 12.6560 },
  { iata: "VIE", icao: "LOWW", name: "Vienna International Airport", city: "Vienna", country: "Austria", region: "Europe", lat: 48.1103, lon: 16.5697 },
  { iata: "BUD", icao: "LHBP", name: "Budapest Ferenc Liszt International Airport", city: "Budapest", country: "Hungary", region: "Europe", lat: 47.4298, lon: 19.2611 },
  { iata: "LEJ", icao: "EDDP", name: "Leipzig/Halle Airport", city: "Leipzig", country: "Germany", region: "Europe", lat: 51.4239, lon: 12.2364 },
  { iata: "LGG", icao: "EBLG", name: "Liege Airport", city: "Liege", country: "Belgium", region: "Europe", lat: 50.6374, lon: 5.4432 },
  { iata: "SYD", icao: "YSSY", name: "Sydney Kingsford Smith Airport", city: "Sydney", country: "Australia", region: "Oceania", lat: -33.9399, lon: 151.1753 },
  { iata: "MEL", icao: "YMML", name: "Melbourne Airport", city: "Melbourne", country: "Australia", region: "Oceania", lat: -37.6690, lon: 144.8410 },
  { iata: "BNE", icao: "YBBN", name: "Brisbane Airport", city: "Brisbane", country: "Australia", region: "Oceania", lat: -27.3842, lon: 153.1175 },
  { iata: "PER", icao: "YPPH", name: "Perth Airport", city: "Perth", country: "Australia", region: "Oceania", lat: -31.9403, lon: 115.9669 },
  { iata: "ADL", icao: "YPAD", name: "Adelaide Airport", city: "Adelaide", country: "Australia", region: "Oceania", lat: -34.9450, lon: 138.5306 },
  { iata: "CNS", icao: "YBCS", name: "Cairns Airport", city: "Cairns", country: "Australia", region: "Oceania", lat: -16.8858, lon: 145.7553 },
  { iata: "AKL", icao: "NZAA", name: "Auckland Airport", city: "Auckland", country: "New Zealand", region: "Oceania", lat: -37.0082, lon: 174.7850 },
  { iata: "LAX", icao: "KLAX", name: "Los Angeles International Airport", city: "Los Angeles", country: "United States", region: "America", lat: 33.9416, lon: -118.4085 },
  { iata: "SFO", icao: "KSFO", name: "San Francisco International Airport", city: "San Francisco", country: "United States", region: "America", lat: 37.6213, lon: -122.3790 },
  { iata: "SEA", icao: "KSEA", name: "Seattle-Tacoma International Airport", city: "Seattle", country: "United States", region: "America", lat: 47.4502, lon: -122.3088 },
  { iata: "JFK", icao: "KJFK", name: "John F. Kennedy International Airport", city: "New York", country: "United States", region: "America", lat: 40.6413, lon: -73.7781 },
  { iata: "EWR", icao: "KEWR", name: "Newark Liberty International Airport", city: "Newark", country: "United States", region: "America", lat: 40.6895, lon: -74.1745 },
  { iata: "ORD", icao: "KORD", name: "O'Hare International Airport", city: "Chicago", country: "United States", region: "America", lat: 41.9742, lon: -87.9073 },
  { iata: "DFW", icao: "KDFW", name: "Dallas/Fort Worth International Airport", city: "Dallas", country: "United States", region: "America", lat: 32.8998, lon: -97.0403 },
  { iata: "ANC", icao: "PANC", name: "Ted Stevens Anchorage International Airport", city: "Anchorage", country: "United States", region: "America", lat: 61.1744, lon: -149.9964 },
  { iata: "YVR", icao: "CYVR", name: "Vancouver International Airport", city: "Vancouver", country: "Canada", region: "America", lat: 49.1967, lon: -123.1815 },
  { iata: "YYZ", icao: "CYYZ", name: "Toronto Pearson International Airport", city: "Toronto", country: "Canada", region: "America", lat: 43.6777, lon: -79.6248 },
  { iata: "MEX", icao: "MMMX", name: "Mexico City International Airport", city: "Mexico City", country: "Mexico", region: "America", lat: 19.4361, lon: -99.0719 }
];

export const AIRPORT_INDEX = new Map(AIRPORTS.map((airport) => [airport.iata, airport]));

export const REGIONS: Region[] = [
  "Greater China",
  "Asia",
  "Middle East",
  "Oceania",
  "America",
  "Africa",
  "Europe",
  "Other"
];

const GREATER_CHINA = new Set(["China", "Hong Kong", "Macau", "Taiwan"]);
const MIDDLE_EAST = new Set([
  "Bahrain",
  "Israel",
  "Kuwait",
  "Oman",
  "Qatar",
  "Saudi Arabia",
  "United Arab Emirates"
]);
const OCEANIA = new Set(["Australia", "New Zealand"]);
const AMERICA = new Set(["United States", "Canada", "Mexico"]);
const AFRICA = new Set([
  "Egypt",
  "Ethiopia",
  "Kenya",
  "Morocco",
  "South Africa"
]);
const EUROPE = new Set([
  "Austria",
  "Belgium",
  "Denmark",
  "Finland",
  "France",
  "Germany",
  "Hungary",
  "Italy",
  "Netherlands",
  "Spain",
  "Switzerland",
  "Turkiye",
  "United Kingdom"
]);

export function getAirport(iata?: string): AirportMetadata | undefined {
  if (!iata) {
    return undefined;
  }
  return AIRPORT_INDEX.get(iata.toUpperCase());
}

export function getAllAirports(): AirportMetadata[] {
  return [...AIRPORTS];
}

export function inferRegionFromCountry(country?: string): Region {
  if (!country) {
    return "Other";
  }
  if (GREATER_CHINA.has(country)) {
    return "Greater China";
  }
  if (MIDDLE_EAST.has(country)) {
    return "Middle East";
  }
  if (OCEANIA.has(country)) {
    return "Oceania";
  }
  if (AMERICA.has(country)) {
    return "America";
  }
  if (AFRICA.has(country)) {
    return "Africa";
  }
  if (EUROPE.has(country)) {
    return "Europe";
  }
  return "Asia";
}
