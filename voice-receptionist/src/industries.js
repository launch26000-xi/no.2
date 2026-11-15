// Trade knowledge the receptionist uses to triage calls like an experienced office manager.
// Each pack lists: what counts as an emergency, the questions to ask, and words the
// speech recognizer should expect.

export const INDUSTRIES = {
  plumbing: {
    label: "plumbing",
    emergencies: [
      "active leak or burst pipe, water spreading",
      "sewage backing up into the home",
      "no water to the whole house",
      "water heater leaking heavily or smelling gas near it",
      "gas smell (tell them to leave the home and call the gas company or 911 first)",
    ],
    questions: [
      "What's going on, and where in the house is it?",
      "Is water actively leaking right now? Have they shut off the main valve? (Offer to explain how: usually where the line enters the house, or at the meter/curb box.)",
      "How old is the fixture or water heater, if they know? Gas or electric water heater?",
      "Is this a house, condo, or business? Do they own or rent? (Renters may need the landlord's approval.)",
    ],
    common_jobs: "drain clogs, leaking faucets and toilets, water heater repair and replacement, tankless heaters, sewer line camera inspection and repair, garbage disposals, sump pumps, repiping, frozen pipes, fixture installs, gas line work",
    hints: "water heater, tankless, sewer line, drain, clog, sump pump, garbage disposal, shutoff valve, PEX, copper, slab leak, backflow, toilet, faucet",
  },
  painting: {
    label: "painting",
    emergencies: [],
    questions: [
      "Interior, exterior, or both? Which rooms or how much of the house?",
      "Rough size: square footage of the home or number of rooms, number of stories for exteriors.",
      "Condition: peeling, water damage, wallpaper removal, drywall patching needed? Any cabinets, trim, decks, or fences?",
      "Was the home built before 1978? (Lead-safe practices may be required.)",
      "Do they have colors picked out, and when do they want the work done?",
    ],
    common_jobs: "interior repaints, exterior repaints, cabinet refinishing, trim and doors, deck and fence staining, drywall repair, commercial repaints, color consultation",
    hints: "interior, exterior, cabinets, trim, primer, stain, deck, fence, drywall, popcorn ceiling, sheen, eggshell, satin, semi-gloss",
  },
  hvac: {
    label: "heating and air conditioning",
    emergencies: [
      "no heat in freezing weather, especially with elderly people, babies, or medical needs",
      "no cooling in dangerous heat with vulnerable people in the home",
      "gas smell or carbon monoxide alarm (tell them to get out and call 911 or the gas company first)",
    ],
    questions: [
      "Is it heating, cooling, or both? What is the system doing or not doing?",
      "Furnace, heat pump, boiler, or mini-split? Roughly how old?",
      "Any error codes, noises, smells, or water around the unit?",
      "Do they have a maintenance plan with us?",
    ],
    common_jobs: "furnace repair, AC repair, heat pump service, tune-ups, system replacement, thermostats, ductwork, mini-splits, indoor air quality",
    hints: "furnace, AC, heat pump, thermostat, compressor, condenser, mini split, boiler, ductwork, filter, tune up, refrigerant, carbon monoxide",
  },
  electrical: {
    label: "electrical",
    emergencies: [
      "burning smell, smoke, sparks, or a hot outlet or panel (tell them to shut off the breaker if safe, and call 911 if there is smoke or fire)",
      "power out to part of the home that isn't fixed by resetting a breaker",
      "downed power lines (tell them to stay away and call the utility and 911)",
    ],
    questions: [
      "What's happening: outlets dead, breaker tripping, flickering lights, or a new install?",
      "Have they tried resetting the breaker or GFCI outlet?",
      "How old is the home and the electrical panel?",
      "For installs: EV charger, panel upgrade, lighting, generator, or remodel wiring?",
    ],
    common_jobs: "troubleshooting, panel upgrades, EV chargers, lighting, ceiling fans, outlets and GFCI, generators, remodel wiring, inspections",
    hints: "breaker, panel, GFCI, outlet, EV charger, generator, rewire, amp, service upgrade, flickering, ceiling fan, recessed lights",
  },
  roofing: {
    label: "roofing",
    emergencies: ["active roof leak during a storm", "storm damage with an opening in the roof (offer emergency tarping if the business provides it)"],
    questions: [
      "Is it a leak, storm or hail damage, or a replacement estimate?",
      "Roof type: asphalt shingle, tile, metal, or flat? Roughly how old?",
      "Are they working with an insurance claim?",
      "Is water coming in right now?",
    ],
    common_jobs: "leak repair, hail and storm damage, insurance claims, full replacement, inspections, gutters, emergency tarping",
    hints: "shingle, hail, leak, flashing, gutter, insurance claim, adjuster, tarp, metal roof, flat roof, TPO",
  },
  landscaping: {
    label: "landscaping and lawn care",
    emergencies: ["broken sprinkler line flooding the yard"],
    questions: [
      "Ongoing maintenance or a one-time project?",
      "What services: mowing, cleanups, sprinklers, trees, design, hardscape?",
      "Rough property size and address?",
    ],
    common_jobs: "weekly mowing, spring and fall cleanups, sprinkler repair and blowouts, tree trimming, sod, landscape design, patios and retaining walls, snow removal",
    hints: "mowing, aeration, sprinkler, irrigation, blowout, sod, mulch, retaining wall, pavers, tree trimming, snow removal",
  },
  cleaning: {
    label: "cleaning",
    emergencies: [],
    questions: [
      "Home or business? Regular, deep clean, or move-in/move-out?",
      "How many bedrooms and bathrooms, or square footage?",
      "Any pets, and any special requests?",
      "Preferred day and how often?",
    ],
    common_jobs: "recurring house cleaning, deep cleans, move-out cleans, office cleaning, carpet cleaning, window washing, post-construction cleanup",
    hints: "deep clean, move out, recurring, biweekly, carpet, windows, office",
  },
  general: {
    label: "home services",
    emergencies: ["anything causing active damage to the home or a safety risk (fire, gas, flooding, electrical): tell them to call 911 first if anyone is in danger"],
    questions: [
      "What do they need done, and where?",
      "How soon do they need it?",
      "Is it a repair, a new install, or an estimate?",
    ],
    common_jobs: "repairs, installs, estimates, remodels, handyman work",
    hints: "estimate, repair, install, remodel, handyman, quote",
  },
};

export function industryPack(name) {
  return INDUSTRIES[String(name || "").toLowerCase()] || INDUSTRIES.general;
}
