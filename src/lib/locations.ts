/**
 * Top cities by U.S. state, ordered by population / business density.
 *
 * Used by the scrape page to quickly append a state's top metros to the
 * locations textarea. Not exhaustive — this is an ergonomic shortcut, not
 * a constraint. Users can still type any location manually.
 */

export interface StateInfo {
  code: string;
  name: string;
  cities: string[]; // ordered by business density (most dense first)
}

export const US_STATES: StateInfo[] = [
  { code: "AL", name: "Alabama", cities: ["Birmingham", "Huntsville", "Montgomery", "Mobile", "Tuscaloosa", "Auburn", "Hoover", "Dothan", "Decatur", "Madison"] },
  { code: "AK", name: "Alaska", cities: ["Anchorage", "Fairbanks", "Juneau", "Wasilla", "Sitka", "Ketchikan", "Kenai", "Kodiak", "Bethel", "Palmer"] },
  { code: "AZ", name: "Arizona", cities: ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Gilbert", "Glendale", "Tempe", "Peoria", "Surprise"] },
  { code: "AR", name: "Arkansas", cities: ["Little Rock", "Fayetteville", "Fort Smith", "Springdale", "Jonesboro", "Rogers", "Conway", "Bentonville", "Hot Springs", "Pine Bluff"] },
  { code: "CA", name: "California", cities: ["Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Sacramento", "Long Beach", "Oakland", "Bakersfield", "Anaheim"] },
  { code: "CO", name: "Colorado", cities: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Thornton", "Arvada", "Westminster", "Pueblo", "Boulder"] },
  { code: "CT", name: "Connecticut", cities: ["Bridgeport", "New Haven", "Stamford", "Hartford", "Waterbury", "Norwalk", "Danbury", "New Britain", "Meriden", "Bristol"] },
  { code: "DE", name: "Delaware", cities: ["Wilmington", "Dover", "Newark", "Middletown", "Smyrna", "Milford", "Seaford", "Georgetown", "Bear", "Glasgow"] },
  { code: "FL", name: "Florida", cities: ["Miami", "Tampa", "Orlando", "Jacksonville", "Fort Lauderdale", "St. Petersburg", "Hialeah", "Tallahassee", "Port St. Lucie", "Cape Coral"] },
  { code: "GA", name: "Georgia", cities: ["Atlanta", "Augusta", "Columbus", "Savannah", "Athens", "Sandy Springs", "Macon", "Roswell", "Johns Creek", "Albany"] },
  { code: "HI", name: "Hawaii", cities: ["Honolulu", "Hilo", "Kailua", "Kaneohe", "Waipahu", "Pearl City", "Kahului", "Mililani", "Ewa Beach", "Kihei"] },
  { code: "ID", name: "Idaho", cities: ["Boise", "Meridian", "Nampa", "Idaho Falls", "Caldwell", "Pocatello", "Coeur d'Alene", "Twin Falls", "Rexburg", "Post Falls"] },
  { code: "IL", name: "Illinois", cities: ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Elgin", "Peoria", "Champaign", "Waukegan"] },
  { code: "IN", name: "Indiana", cities: ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel", "Fishers", "Bloomington", "Hammond", "Gary", "Lafayette"] },
  { code: "IA", name: "Iowa", cities: ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City", "Waterloo", "Ames", "West Des Moines", "Council Bluffs", "Dubuque"] },
  { code: "KS", name: "Kansas", cities: ["Wichita", "Overland Park", "Kansas City", "Olathe", "Topeka", "Lawrence", "Shawnee", "Manhattan", "Lenexa", "Salina"] },
  { code: "KY", name: "Kentucky", cities: ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington", "Richmond", "Florence", "Hopkinsville", "Elizabethtown", "Nicholasville"] },
  { code: "LA", name: "Louisiana", cities: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles", "Kenner", "Bossier City", "Monroe", "Alexandria", "Houma"] },
  { code: "ME", name: "Maine", cities: ["Portland", "Lewiston", "Bangor", "South Portland", "Auburn", "Biddeford", "Sanford", "Augusta", "Saco", "Westbrook"] },
  { code: "MD", name: "Maryland", cities: ["Baltimore", "Columbia", "Germantown", "Silver Spring", "Waldorf", "Frederick", "Ellicott City", "Glen Burnie", "Rockville", "Gaithersburg"] },
  { code: "MA", name: "Massachusetts", cities: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "Brockton", "Quincy", "Lynn", "New Bedford", "Newton"] },
  { code: "MI", name: "Michigan", cities: ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Lansing", "Flint", "Dearborn", "Livonia", "Troy"] },
  { code: "MN", name: "Minnesota", cities: ["Minneapolis", "St. Paul", "Rochester", "Duluth", "Bloomington", "Brooklyn Park", "Plymouth", "St. Cloud", "Eagan", "Woodbury"] },
  { code: "MS", name: "Mississippi", cities: ["Jackson", "Gulfport", "Southaven", "Biloxi", "Hattiesburg", "Olive Branch", "Tupelo", "Meridian", "Greenville", "Madison"] },
  { code: "MO", name: "Missouri", cities: ["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence", "Lee's Summit", "O'Fallon", "St. Joseph", "St. Charles", "Blue Springs"] },
  { code: "MT", name: "Montana", cities: ["Billings", "Missoula", "Great Falls", "Bozeman", "Butte", "Helena", "Kalispell", "Havre", "Anaconda", "Miles City"] },
  { code: "NE", name: "Nebraska", cities: ["Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney", "Fremont", "Hastings", "Norfolk", "North Platte", "Columbus"] },
  { code: "NV", name: "Nevada", cities: ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks", "Carson City", "Fernley", "Elko", "Mesquite", "Boulder City"] },
  { code: "NH", name: "New Hampshire", cities: ["Manchester", "Nashua", "Concord", "Dover", "Rochester", "Keene", "Portsmouth", "Laconia", "Lebanon", "Claremont"] },
  { code: "NJ", name: "New Jersey", cities: ["Newark", "Jersey City", "Paterson", "Elizabeth", "Edison", "Woodbridge", "Lakewood", "Toms River", "Hamilton", "Trenton"] },
  { code: "NM", name: "New Mexico", cities: ["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe", "Roswell", "Farmington", "Clovis", "Hobbs", "Alamogordo", "Carlsbad"] },
  { code: "NY", name: "New York", cities: ["New York", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany", "New Rochelle", "Mount Vernon", "Schenectady", "Utica"] },
  { code: "NC", name: "North Carolina", cities: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville", "Cary", "Wilmington", "High Point", "Concord"] },
  { code: "ND", name: "North Dakota", cities: ["Fargo", "Bismarck", "Grand Forks", "Minot", "West Fargo", "Williston", "Dickinson", "Mandan", "Jamestown", "Wahpeton"] },
  { code: "OH", name: "Ohio", cities: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Parma", "Canton", "Youngstown", "Lorain"] },
  { code: "OK", name: "Oklahoma", cities: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Lawton", "Edmond", "Moore", "Midwest City", "Enid", "Stillwater"] },
  { code: "OR", name: "Oregon", cities: ["Portland", "Salem", "Eugene", "Gresham", "Hillsboro", "Beaverton", "Bend", "Medford", "Springfield", "Corvallis"] },
  { code: "PA", name: "Pennsylvania", cities: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton", "Bethlehem", "Lancaster", "Harrisburg", "York"] },
  { code: "RI", name: "Rhode Island", cities: ["Providence", "Warwick", "Cranston", "Pawtucket", "East Providence", "Woonsocket", "Newport", "Central Falls", "Westerly", "North Providence"] },
  { code: "SC", name: "South Carolina", cities: ["Charleston", "Columbia", "North Charleston", "Mount Pleasant", "Rock Hill", "Greenville", "Summerville", "Sumter", "Goose Creek", "Hilton Head Island"] },
  { code: "SD", name: "South Dakota", cities: ["Sioux Falls", "Rapid City", "Aberdeen", "Brookings", "Watertown", "Mitchell", "Yankton", "Pierre", "Huron", "Spearfish"] },
  { code: "TN", name: "Tennessee", cities: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Franklin", "Jackson", "Johnson City", "Bartlett"] },
  { code: "TX", name: "Texas", cities: ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso", "Arlington", "Corpus Christi", "Plano", "Lubbock"] },
  { code: "UT", name: "Utah", cities: ["Salt Lake City", "West Valley City", "Provo", "West Jordan", "Orem", "Sandy", "Ogden", "St. George", "Layton", "South Jordan"] },
  { code: "VT", name: "Vermont", cities: ["Burlington", "South Burlington", "Rutland", "Essex Junction", "Barre", "Montpelier", "Winooski", "St. Albans", "Newport", "Vergennes"] },
  { code: "VA", name: "Virginia", cities: ["Virginia Beach", "Chesapeake", "Norfolk", "Richmond", "Newport News", "Arlington", "Hampton", "Alexandria", "Roanoke", "Portsmouth"] },
  { code: "WA", name: "Washington", cities: ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue", "Kent", "Everett", "Renton", "Spokane Valley", "Federal Way"] },
  { code: "WV", name: "West Virginia", cities: ["Charleston", "Huntington", "Morgantown", "Parkersburg", "Wheeling", "Weirton", "Fairmont", "Martinsburg", "Beckley", "Clarksburg"] },
  { code: "WI", name: "Wisconsin", cities: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine", "Appleton", "Waukesha", "Eau Claire", "Oshkosh", "Janesville"] },
  { code: "WY", name: "Wyoming", cities: ["Cheyenne", "Casper", "Laramie", "Gillette", "Rock Springs", "Sheridan", "Green River", "Evanston", "Riverton", "Jackson"] },
];

/** Get state info by 2-letter code (case-insensitive). */
export function getState(code: string): StateInfo | undefined {
  const upper = code.toUpperCase();
  return US_STATES.find((s) => s.code === upper);
}

/** Format a city + state into the textarea shape ("Tampa, FL"). */
export function formatCityState(city: string, stateCode: string): string {
  return `${city}, ${stateCode}`;
}
