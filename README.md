# Got Next Austin

Pick a sport and a distance, and see which Austin courts are open to walk onto right now.

**What it does**

- Six sports: basketball, pickleball, tennis, soccer, volleyball and badminton
- Indoor, Outdoor or Both
- A 1 to 15 mile radius from one of 16 Austin neighborhoods
- A street map (Leaflet and OpenStreetMap, no API key) with numbered pins colored by status and a compass
- Sort results by open first, nearest, closes latest or name
- "Use my location", or drag the start pin, to measure from where you are
- Directions links that open Google Maps with the venue as the destination
- Status that follows the clock in Austin time: cards flip to closed when a session ends, with an alert 30 minutes before
- A "Pick a day and time" mode for planning ahead

**Run it**

It is a single file with no build step. Open `index.html` in a browser, or serve the folder with any static host such as GitHub Pages.

**Data**

- Indoor times are the free open play hours each City of Austin recreation center posted on its gym schedule, collected November 11, 2026.
- Outdoor courts and fields come from the City of Austin parks facility inventory (the `pard_facility_points` map service), pulled November 11, 2026: 103 parks with real coordinates. They are treated as open during city park hours, 5 a.m. to 10 p.m., unless the city posts shorter court hours.
- Distances are straight lines from the starting point.
- Coverage is the City of Austin park system. Suburban parks (Round Rock, Pflugerville, Cedar Park and others) are not included yet.
- The city changes gym schedules without notice. Venues with an older schedule are marked "Possibly outdated" in the app.

To add or update a rec center, edit the `VENUES` list near the top of the script in `index.html`. Parks live in the `PARK_DATA` block, one line per park.

**Live closure reports**

The app can share "Report closed" updates between everyone who has it open. That feature uses the shared data store of the Claude artifact the app was built in, so it is switched off when the page is hosted elsewhere, including here. One known city notice (the Pan Am gym closure) is built in.
