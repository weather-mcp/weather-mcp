/**
 * Heat/cold stress utility functions: computed wind chill / frostbite
 * time-to-onset (cold) and simplified WBGT / heat-stress exertion
 * category (heat).
 *
 * Pure module, zero imports — same discipline as `fireWeather.ts`. Unlike
 * that module's `NaN` sentinel (Fosberg), every function here returns
 * `null` on invalid/non-finite input; this is a deliberate, different
 * convention for this module, chosen so callers can `if (x === null)`
 * without a `Number.isFinite` check at every call site.
 */

/**
 * Calculate the North American Wind Chill Index (WCI).
 *
 * Reference: the joint NWS/Environment Canada 2001 wind chill model
 * (Osczevski & Bluestein, "The New Wind Chill Equivalent Temperature
 * Chart", Bull. Amer. Meteor. Soc., 2005), as published by the NWS:
 *
 *   WC = 35.74 + 0.6215*T - 35.75*V^0.16 + 0.4275*T*V^0.16
 *
 * where T is air temperature in degrees Fahrenheit and V is wind speed
 * in miles per hour.
 *
 * The model's published validity domain is T <= 50 F and V >= 3 mph
 * (below 3 mph the formula's V^0.16 term becomes numerically unstable and
 * the underlying convective-heat-loss model no longer applies). Outside
 * that domain, or on any non-finite input (NaN or +/-Infinity), this
 * function returns `null` rather than a misleading extrapolated number.
 * (A caller wanting a value below 3 mph — "calm air still freezes skin"
 * — must substitute the air temperature itself; that carve-out is a
 * rendering decision, not part of this pure formula, so it lives in the
 * handler, not here.)
 *
 * @param tempF Air temperature in degrees Fahrenheit
 * @param windMph Sustained wind speed in miles per hour
 * @returns Wind chill in degrees Fahrenheit, or `null` if outside the
 *   formula's validity domain or given non-finite input
 */
export function calculateWindChillF(tempF: number, windMph: number): number | null {
  if (!Number.isFinite(tempF) || !Number.isFinite(windMph)) {
    return null;
  }

  if (tempF > 50 || windMph < 3) {
    return null;
  }

  const vPow = Math.pow(windMph, 0.16);
  return 35.74 + 0.6215 * tempF - 35.75 * vPow + 0.4275 * tempF * vPow;
}

/**
 * Frostbite time-to-onset for exposed skin, banded from a computed wind
 * chill value.
 *
 * Bands are **adapted from Environment Canada's wind chill program**
 * (published in degrees Celsius) to Fahrenheit equivalents — this
 * Fahrenheit banding is a **project heuristic adaptation**, not an
 * agency-published Fahrenheit scale. The underlying time-to-frostbite
 * figures describe the most cold-susceptible fraction of the population
 * exposed to open air; the conservative direction is intentional for a
 * safety line. The claim's scope is **exposed skin only** — covered skin
 * is not at this risk.
 *
 * Per the caller contract shared with `getWbgtCategory`: pass the
 * **rounded** display value here, so the number shown to the user and
 * the band it falls in can never disagree at an edge.
 *
 * @param windChillF Wind chill in degrees Fahrenheit (rounded display value)
 * @returns Risk level/time-to-onset/description, or `null` when the wind
 *   chill is above -18 F (no near-term frostbite risk from cold air
 *   alone) or the input is non-finite
 */
export function getFrostbiteRisk(
  windChillF: number
): { level: string; timeToFrostbite: string; description: string } | null {
  if (!Number.isFinite(windChillF)) {
    return null;
  }

  if (windChillF > -18) {
    return null;
  }

  if (windChillF > -40) {
    return {
      level: 'High',
      timeToFrostbite: '10–30 minutes',
      description: 'Exposed skin can freeze in as little as 10 to 30 minutes.'
    };
  }

  if (windChillF > -54) {
    return {
      level: 'Very High',
      timeToFrostbite: '5–10 minutes',
      description: 'Exposed skin can freeze in as little as 5 to 10 minutes.'
    };
  }

  if (windChillF > -67) {
    return {
      level: 'Severe',
      timeToFrostbite: '2–5 minutes',
      description: 'Exposed skin can freeze in as little as 2 to 5 minutes.'
    };
  }

  return {
    level: 'Extreme',
    timeToFrostbite: 'under 2 minutes',
    description: 'Exposed skin can freeze in under 2 minutes. Extremely dangerous conditions.'
  };
}

/**
 * Calculate a simplified Wet-Bulb Globe Temperature (WBGT) estimate.
 *
 * Reference: the Australian Bureau of Meteorology's simplified WBGT
 * approximation for outdoor conditions, computed from temperature and
 * relative humidity alone (no direct solar radiation or wind
 * measurement):
 *
 *   e = (RH/100) * 6.105 * exp(17.27*T / (237.7+T))   [water-vapour
 *       pressure in hPa, T in degrees Celsius]
 *   WBGT = 0.567*T + 0.393*e + 3.94                    [degrees Celsius]
 *
 * The Bureau's own documentation states this simplified formula assumes
 * **moderately high radiation with light wind** — i.e. it is a full-sun
 * outdoor estimate. In shade or overcast conditions, or in strong wind,
 * the true WBGT is lower than this estimate; treat the result as a
 * conservative (upper-bound-leaning) approximation, not a measured value.
 *
 * Returns `null` on any non-finite input (NaN or +/-Infinity).
 *
 * @param tempF Air temperature in degrees Fahrenheit
 * @param rhPercent Relative humidity as a percentage (0-100 in normal use)
 * @returns Estimated WBGT in degrees Fahrenheit, or `null` if either
 *   input is non-finite
 */
export function calculateSimplifiedWbgtF(tempF: number, rhPercent: number): number | null {
  if (!Number.isFinite(tempF) || !Number.isFinite(rhPercent)) {
    return null;
  }

  const tempC = ((tempF - 32) * 5) / 9;
  const vapourPressure = (rhPercent / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  const wbgtC = 0.567 * tempC + 0.393 * vapourPressure + 3.94;
  return (wbgtC * 9) / 5 + 32;
}

/**
 * Heat-stress exertion category from an estimated WBGT value.
 *
 * Bands follow the widely used flag-condition-style WBGT categories
 * (in degrees Fahrenheit) — this banding is a **project heuristic**:
 * real acclimatization genuinely shifts the exertion thresholds for a
 * given individual, so treat these as general guidance, not a
 * personalized medical/occupational determination.
 *
 * Per the caller contract shared with `getFrostbiteRisk`: pass the
 * **rounded** display value here, so the number shown to the user and
 * the band it falls in can never disagree at an edge.
 *
 * @param wbgtF Estimated WBGT in degrees Fahrenheit (rounded display value)
 * @returns Level/description, or `null` when WBGT is below 80 F (no
 *   elevated heat-stress concern) or the input is non-finite
 */
export function getWbgtCategory(wbgtF: number): { level: string; description: string } | null {
  if (!Number.isFinite(wbgtF)) {
    return null;
  }

  if (wbgtF < 80) {
    return null;
  }

  if (wbgtF <= 84) {
    return {
      level: 'Elevated',
      description: 'Use caution during prolonged outdoor exertion; take breaks and hydrate.'
    };
  }

  if (wbgtF <= 87) {
    return {
      level: 'High',
      description: 'Limit intense outdoor exertion; rest frequently in shade and hydrate.'
    };
  }

  if (wbgtF <= 89) {
    return {
      level: 'Very High',
      description: 'Curtail strenuous outdoor exertion; rest often, hydrate, and seek shade.'
    };
  }

  return {
    level: 'Extreme',
    description: 'Outdoor exertion is dangerous; rest often, hydrate, and seek shade.'
  };
}
