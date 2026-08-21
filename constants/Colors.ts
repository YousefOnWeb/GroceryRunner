export const GOLD_HUE = 46;
export const GOLD_SATURATION = '20%'; // <--- ADJUST THIS VALUE TO CONTROL SATURATION
export const GOLD = (lightness: string, saturation = GOLD_SATURATION) => 
  `hsl(${GOLD_HUE}, ${saturation}, ${lightness})`;

export const ACCENT_GOLD = GOLD('52%');
export const LIGHT_GOLD = GOLD('75%');

export const METALLIC_BEVEL = [GOLD('84%'), GOLD('49%'), GOLD('32%')] as const;
export const LIQUID_GOLD_STOPS = [
  GOLD('49%'), GOLD('52%'), GOLD('55%'), GOLD('58%'), GOLD('61%'), GOLD('64%'), GOLD('67%'), GOLD('72%'),
  GOLD('76%'), GOLD('80%'), GOLD('83%'), GOLD('84%'), GOLD('83%'), GOLD('80%'), GOLD('76%'), GOLD('72%'),
  GOLD('67%'), GOLD('64%'), GOLD('61%'), GOLD('58%'), GOLD('55%'), GOLD('52%'), GOLD('49%')
] as const;

export const SILVER_HUE = 210;
export const SILVER_SATURATION = '15%'; 
export const SILVER = (lightness: string, saturation = SILVER_SATURATION) => 
  `hsl(${SILVER_HUE}, ${saturation}, ${lightness})`;

export const SILVER_BEVEL = [SILVER('80%'), SILVER('45%'), SILVER('30%')] as const;
export const LIQUID_SILVER_STOPS = [
  SILVER('45%'), SILVER('50%'), SILVER('55%'), SILVER('60%'), SILVER('65%'), SILVER('70%'), SILVER('75%'), SILVER('80%'),
  SILVER('85%'), SILVER('88%'), SILVER('92%'), SILVER('95%'), SILVER('92%'), SILVER('88%'), SILVER('85%'), SILVER('80%'),
  SILVER('75%'), SILVER('70%'), SILVER('65%'), SILVER('60%'), SILVER('55%'), SILVER('50%'), SILVER('45%')
] as const;

export default {
  light: {
    text: '#fff',
    background: 'transparent',
    tint: ACCENT_GOLD,
    tabIconDefault: '#ccc',
    tabIconSelected: ACCENT_GOLD,
  },
  dark: {
    text: '#fff',
    background: 'transparent',
    tint: ACCENT_GOLD,
    tabIconDefault: '#ccc',
    tabIconSelected: ACCENT_GOLD,
  },
};
