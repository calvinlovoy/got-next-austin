# Got Next Austin

Pick a sport and a distance, and see which Austin courts are open to walk onto right now.

**What it does**

- Six sports: basketball, pickleball, tennis, soccer, volleyball and badminton
- Indoor, Outdoor or Both
- A 1 to 15 mile radius from one of 16 Austin neighborhoods
- A street map (Leaflet and OpenStreetMap, no API key) with numbered pins colored by status and a compass
- Sort results by nearest, open first, closes latest, most courts (most fields for soccer) or name
- "Use my location", type an Austin address, or drag the start pin, to measure from where you are
- Directions links that open Google Maps with the venue as the destination
- Status that follows the clock in Austin time: cards flip to closed when a session ends, with an alert 30 minutes before
- A "Pick a day and time" mode for planning ahead

**Run it**

It is a single file with no build step. Open `index.html` in a browser, or serve the folder with any static host such as GitHub Pages.

**Data**

- Indoor times are the free open play hours each City of Austin recreation center posted on its gym schedule, collected November 11, 2026.
- Outdoor courts and fields come from the City of Austin parks facility inventory (the `pard_facility_points` map service), pulled November 11, 2026: 103 parks with real coordinates. They are treated as open during city park hours, 5 a.m. to 10 p.m., unless the city posts shorter court hours.
- Distances are straight lines from the starting point.
- Parks outside the City of Austin system come from OpenStreetMap, snapshot November 12, 2026 (the `AREA_DATA` block). The area is the address search box plus 15 miles on every side, roughly Georgetown and Burnet in the north to San Marcos and Lockhart in the south. A park is listed when OpenStreetMap has a court or field mapped inside a named park that is not tagged private. School, club, HOA and apartment courts are left out where the tags or the name show it. Hours for these parks are assumed, and some may be for residents only.
- Rec centers outside Austin are not included.
- Map data © OpenStreetMap contributors, available under the Open Database License.
- The city changes gym schedules without notice. Venues with an older schedule are marked "Possibly outdated" in the app.

To add or update a rec center, edit the `VENUES` list near the top of the script in `index.html`. Parks live in the `PARK_DATA` block, one line per park.

**Automatic updates**

A scheduled job (`.github/workflows/refresh.yml`) runs every Monday morning and can be started by hand from the Actions tab with "Run workflow".

- Parks: `scripts/update-parks.mjs` pulls the current courts and fields from the city inventory and rewrites the `PARK_DATA` block when something changed. The new data has to pass size and location checks and `scripts/smoke.mjs` before it is saved. If it fails, the old data stays.
- Rec center schedules: `scripts/check-schedules.mjs` reads each rec center page and remembers its schedule links, the files behind them and any posted open play times in `data/schedule-fingerprints.json`. When one of those changes, the job opens an issue that lists what moved. It does not rewrite the times in `VENUES`. Those are still updated by hand from the new schedule.
- The first run only records a starting point. A center that cannot be read two weeks in a row is listed in an issue too.

**Live closure reports**

The app can share "Report closed" updates between everyone who has it open. That feature uses the shared data store of the Claude artifact the app was built in, so it is switched off when the page is hosted elsewhere, including here. One known city notice (the Pan Am gym closure) is built in.
