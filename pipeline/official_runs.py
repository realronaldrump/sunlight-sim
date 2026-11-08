"""Official Sunlight run list (2024-25 trail map + East Ridge map, sunlightmtn.com) and how it maps
onto OpenStreetMap ways. The official map wins wherever OSM disagrees (spec section 3).

difficulty: green | blue | black | double  (park = terrain park, hike = hike-out)
"""

OFFICIAL = {
    # Easiest (green circle)
    "Grizzly Road": "green", "The Parks": "green", "Loop": "green", "Tercero": "green", "Midway": "green",
    "Ute": "green", "Segundo Road": "green", "Columbine": "green", "Ivy's Run": "green", "Buckmaster": "green",
    # More difficult (blue square)
    "Grizzly Face": "blue", "Beaujolais": "blue", "Rebel": "blue", "Sun King": "blue", "Little Max": "blue",
    "Blue Tango": "blue", "Joslin": "blue", "Sundance": "blue", "Blue Catwalk": "blue", "Ferret's Hollow": "blue",
    "Peace Pipe": "blue", "Dawson": "blue", "Crystal": "blue", "Ute Cutoff": "blue", "Fliprock": "blue",
    "Sunburst": "blue", "White River": "blue", "Cornice": "blue", "Lower Columbine": "blue",
    "Enchanted Forest": "blue", "Lower Beaujolais": "blue", "Sundown": "blue", "Dotsero": "blue",
    # Most difficult (black diamond)
    "Zephyr": "black", "Primo": "black", "Blue Finger": "black", "Defiance": "black", "Inspiration": "black",
    "Gnarly Knob": "black", "Segundo": "black", "Showdown": "black", "Holiday Hill": "black",
    "Frying Pan Alley": "black", "E. Wishbone Alley": "black", "Sherman Forest": "black", "W. Wishbone": "black",
    "Midland Traverse": "black",
    # Experts only (double black diamond), East Ridge and glades
    "Tom J's Glades": "double", "Zephyr Glades": "double", "Gibson Glades": "double", "Joslin Glades": "double",
    "Cassanova Glades": "double", "Charlie's Glades": "double", "Gilberto Glades": "double",
    "Aligator Alley A1": "double", "Aligator Alley A2": "double", "Aligator Alley A3": "double",
    "Perry's Plunge": "double", "Deception": "double", "Lower Deception": "double", "Cedar Glades": "double",
    "Que Pasa": "double", "Lower Que Pasa": "double", "Lower Defiance": "double", "The Alamo": "double",
    "Rapid Transit": "double", "The Heathen": "double", "Teeds Run": "double", "Banzai": "double",
    "Tod's Ride": "double", "Devil's Dare": "double", "Vortex": "double", "Sundown Glades": "double",
    # Other
    "Sherick Park": "park", "Hike-Out Only": "hike",
}

# OSM name -> official name
RENAME = {
    "Peacepipe": "Peace Pipe", "Finger": "Blue Finger", "Teed's Run": "Teeds Run", "Ceder Glades": "Cedar Glades",
    "A1": "Aligator Alley A1", "A2": "Aligator Alley A2", "A3": "Aligator Alley A3", "Hike Out": "Hike-Out Only",
}

# Unnamed OSM ways matched to official names by location (see DECISIONS.md D3).
BY_ID = {
    99613021: "Inspiration",       # unnamed East Ridge line between Que Pasa and The Alamo
    99620885: "Segundo Road",      # leaves the top of Segundo lift heading west to Ute
    99624947: "Columbine",         # green section from Segundo Road down the west side
    1444285246: "Lower Columbine", # blue continuation
    99624948: "Lower Columbine",
    # six bump lines west of the Segundo lift, ordered from the lift going west (official map order)
    99624940: "Showdown", 99624931: "Holiday Hill", 99624932: "Frying Pan Alley",
    99624934: "E. Wishbone Alley", 99624935: "Sherman Forest", 99624933: "W. Wishbone",
}

# Runs whose official map symbol is the terrain-park pill or that are traverses (no sign needed at top)
NO_SIGN = {"Hike-Out Only"}
