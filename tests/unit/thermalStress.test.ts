import { describe, it, expect } from 'vitest';
import {
  calculateWindChillF,
  getFrostbiteRisk,
  calculateSimplifiedWbgtF,
  getWbgtCategory,
} from '../../src/utils/thermalStress.js';

describe('Thermal Stress Utilities', () => {
  describe('calculateWindChillF', () => {
    describe('Hand-verified vectors (spanning the published NWS wind-chill chart)', () => {
      it('T=5F, V=30mph -> approx -19F (matches the NWS chart cell)', () => {
        // WC = 35.74 + 0.6215*T - 35.75*V^0.16 + 0.4275*T*V^0.16
        // V^0.16 = 30^0.16 = exp(0.16*ln30) = exp(0.16*3.401197)
        //        = exp(0.544192) ~= 1.723227
        // WC = 35.74 + 0.6215*5 - 35.75*1.723227 + 0.4275*5*1.723227
        //    = 35.74 + 3.1075 - 61.6055 + 3.6839
        //    ~= -19.07 F  (NWS published chart cell: -19 F)
        const result = calculateWindChillF(5, 30);
        expect(result).not.toBeNull();
        expect(result as number).toBeCloseTo(-19.07, 1);
      });

      it('T=-20F, V=10mph -> approx -40.7F (rounds to the NWS chart cell -41F)', () => {
        // V^0.16 = 10^0.16 = exp(0.16*ln10) = exp(0.16*2.302585)
        //        = exp(0.368414) ~= 1.445444
        // WC = 35.74 + 0.6215*(-20) - 35.75*1.445444 + 0.4275*(-20)*1.445444
        //    = 35.74 - 12.43 - 51.674623 - 12.358544
        //    ~= -40.72 F  (rounds to the NWS published chart cell -41 F)
        const result = calculateWindChillF(-20, 10);
        expect(result).not.toBeNull();
        expect(result as number).toBeCloseTo(-40.72, 1);
      });

      it('T=30F, V=10mph -> approx 21F (matches the NWS chart cell)', () => {
        // V^0.16 = 10^0.16 ~= 1.445444 (as above)
        // WC = 35.74 + 0.6215*30 - 35.75*1.445444 + 0.4275*30*1.445444
        //    = 35.74 + 18.645 - 51.674623 + 18.538066
        //    ~= 21.25 F  (rounds to the NWS published chart cell 21 F)
        const result = calculateWindChillF(30, 10);
        expect(result).not.toBeNull();
        expect(result as number).toBeCloseTo(21.25, 1);
      });
    });

    describe('Validity domain', () => {
      it('returns null when temperature is above 50F', () => {
        expect(calculateWindChillF(50.1, 10)).toBeNull();
        expect(calculateWindChillF(70, 20)).toBeNull();
      });

      it('accepts temperature exactly at the 50F boundary', () => {
        expect(calculateWindChillF(50, 10)).not.toBeNull();
      });

      it('returns null when wind speed is below 3mph', () => {
        expect(calculateWindChillF(20, 2.9)).toBeNull();
        expect(calculateWindChillF(20, 0)).toBeNull();
      });

      it('accepts wind speed exactly at the 3mph boundary', () => {
        expect(calculateWindChillF(20, 3)).not.toBeNull();
      });
    });

    describe('Non-finite inputs', () => {
      it('returns null when temperature is NaN', () => {
        expect(calculateWindChillF(NaN, 10)).toBeNull();
      });

      it('returns null when wind is Infinity', () => {
        expect(calculateWindChillF(10, Infinity)).toBeNull();
      });

      it('returns null when temperature is -Infinity', () => {
        expect(calculateWindChillF(-Infinity, 10)).toBeNull();
      });

      it('returns null when both inputs are non-finite', () => {
        expect(calculateWindChillF(NaN, Infinity)).toBeNull();
      });
    });
  });

  describe('getFrostbiteRisk', () => {
    describe('No-risk zone', () => {
      it('returns null above -18F', () => {
        expect(getFrostbiteRisk(-17)).toBeNull();
        expect(getFrostbiteRisk(0)).toBeNull();
        expect(getFrostbiteRisk(32)).toBeNull();
      });
    });

    describe('Band edge: -18', () => {
      it('-17 is null (no risk), -18 is High', () => {
        expect(getFrostbiteRisk(-17)).toBeNull();
        const result = getFrostbiteRisk(-18);
        expect(result).not.toBeNull();
        expect(result?.level).toBe('High');
        expect(result?.timeToFrostbite).toBe('10–30 minutes');
      });
    });

    describe('Band edge: -40', () => {
      it('-39 is High, -40 is Very High', () => {
        const high = getFrostbiteRisk(-39);
        expect(high?.level).toBe('High');
        expect(high?.timeToFrostbite).toBe('10–30 minutes');

        const veryHigh = getFrostbiteRisk(-40);
        expect(veryHigh?.level).toBe('Very High');
        expect(veryHigh?.timeToFrostbite).toBe('5–10 minutes');
      });
    });

    describe('Band edge: -54', () => {
      it('-53 is Very High, -54 is Severe', () => {
        const veryHigh = getFrostbiteRisk(-53);
        expect(veryHigh?.level).toBe('Very High');
        expect(veryHigh?.timeToFrostbite).toBe('5–10 minutes');

        const severe = getFrostbiteRisk(-54);
        expect(severe?.level).toBe('Severe');
        expect(severe?.timeToFrostbite).toBe('2–5 minutes');
      });
    });

    describe('Band edge: -67', () => {
      it('-66 is Severe, -67 is Extreme', () => {
        const severe = getFrostbiteRisk(-66);
        expect(severe?.level).toBe('Severe');
        expect(severe?.timeToFrostbite).toBe('2–5 minutes');

        const extreme = getFrostbiteRisk(-67);
        expect(extreme?.level).toBe('Extreme');
        expect(extreme?.timeToFrostbite).toBe('under 2 minutes');
      });

      it('well below -67 stays Extreme', () => {
        const result = getFrostbiteRisk(-114);
        expect(result?.level).toBe('Extreme');
        expect(result?.timeToFrostbite).toBe('under 2 minutes');
      });
    });

    describe('Return value structure', () => {
      it('has all required fields', () => {
        const result = getFrostbiteRisk(-40);
        expect(result).toHaveProperty('level');
        expect(result).toHaveProperty('timeToFrostbite');
        expect(result).toHaveProperty('description');
        expect(typeof result?.level).toBe('string');
        expect(typeof result?.timeToFrostbite).toBe('string');
        expect(typeof result?.description).toBe('string');
      });
    });

    describe('Non-finite inputs', () => {
      it('returns null for NaN', () => {
        expect(getFrostbiteRisk(NaN)).toBeNull();
      });

      it('returns null for Infinity', () => {
        expect(getFrostbiteRisk(Infinity)).toBeNull();
      });

      it('returns null for -Infinity', () => {
        expect(getFrostbiteRisk(-Infinity)).toBeNull();
      });
    });
  });

  describe('calculateSimplifiedWbgtF', () => {
    describe('Hand-verified vectors (ABM simplified formula)', () => {
      it('T=95F (35C), RH=50% -> approx 34.8C / 94.6F', () => {
        // tempC = (95-32)*5/9 = 35C
        // e = (50/100) * 6.105 * exp(17.27*35 / (237.7+35))
        //   exponent = 604.45 / 272.7 = 2.21656
        //   exp(2.21656) ~= 9.1757
        //   e = 0.5 * 6.105 * 9.1757 ~= 28.009 hPa
        // WBGT(C) = 0.567*35 + 0.393*28.009 + 3.94
        //         = 19.845 + 11.0075 + 3.94
        //         ~= 34.79 C
        // WBGT(F) = 34.79*9/5 + 32 ~= 94.63 F
        const result = calculateSimplifiedWbgtF(95, 50);
        expect(result).not.toBeNull();
        expect(result as number).toBeCloseTo(94.63, 1);
      });

      it('T=86F (30C), RH=60% -> approx 30.9C / 87.7F', () => {
        // tempC = (86-32)*5/9 = 30C
        // e = (60/100) * 6.105 * exp(17.27*30 / (237.7+30))
        //   exponent = 518.1 / 267.7 = 1.935375
        //   exp(1.935375) ~= 6.926653
        //   e = 0.6 * 6.105 * 6.926653 ~= 25.372 hPa
        // WBGT(C) = 0.567*30 + 0.393*25.372 + 3.94
        //         = 17.01 + 9.971196 + 3.94
        //         ~= 30.92 C
        // WBGT(F) = 30.92*9/5 + 32 ~= 87.66 F
        const result = calculateSimplifiedWbgtF(86, 60);
        expect(result).not.toBeNull();
        expect(result as number).toBeCloseTo(87.66, 1);
      });
    });

    describe('Non-finite inputs', () => {
      it('returns null when temperature is NaN', () => {
        expect(calculateSimplifiedWbgtF(NaN, 50)).toBeNull();
      });

      it('returns null when humidity is Infinity', () => {
        expect(calculateSimplifiedWbgtF(90, Infinity)).toBeNull();
      });

      it('returns null when temperature is -Infinity', () => {
        expect(calculateSimplifiedWbgtF(-Infinity, 50)).toBeNull();
      });

      it('returns null when both inputs are non-finite', () => {
        expect(calculateSimplifiedWbgtF(NaN, NaN)).toBeNull();
      });
    });
  });

  describe('getWbgtCategory', () => {
    describe('No-concern zone', () => {
      it('returns null below 80F', () => {
        expect(getWbgtCategory(79)).toBeNull();
        expect(getWbgtCategory(50)).toBeNull();
      });
    });

    describe('Band edge: 80', () => {
      it('79 is null, 80 is Elevated', () => {
        expect(getWbgtCategory(79)).toBeNull();
        const result = getWbgtCategory(80);
        expect(result?.level).toBe('Elevated');
      });
    });

    describe('Band edge: 85', () => {
      it('84 is Elevated, 85 is High', () => {
        expect(getWbgtCategory(84)?.level).toBe('Elevated');
        expect(getWbgtCategory(85)?.level).toBe('High');
      });
    });

    describe('Band edge: 88', () => {
      it('87 is High, 88 is Very High', () => {
        expect(getWbgtCategory(87)?.level).toBe('High');
        expect(getWbgtCategory(88)?.level).toBe('Very High');
      });
    });

    describe('Band edge: 90', () => {
      it('89 is Very High, 90 is Extreme', () => {
        expect(getWbgtCategory(89)?.level).toBe('Very High');
        expect(getWbgtCategory(90)?.level).toBe('Extreme');
      });

      it('well above 90 stays Extreme', () => {
        expect(getWbgtCategory(120)?.level).toBe('Extreme');
      });
    });

    describe('Return value structure', () => {
      it('has all required fields', () => {
        const result = getWbgtCategory(85);
        expect(result).toHaveProperty('level');
        expect(result).toHaveProperty('description');
        expect(typeof result?.level).toBe('string');
        expect(typeof result?.description).toBe('string');
      });
    });

    describe('Non-finite inputs', () => {
      it('returns null for NaN', () => {
        expect(getWbgtCategory(NaN)).toBeNull();
      });

      it('returns null for Infinity', () => {
        expect(getWbgtCategory(Infinity)).toBeNull();
      });

      it('returns null for -Infinity', () => {
        expect(getWbgtCategory(-Infinity)).toBeNull();
      });
    });
  });
});
