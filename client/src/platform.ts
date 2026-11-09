/** Decide once at launch, so rotation, keyboards and saved preferences cannot unlock skiing. */
export function isIPhone(device: { userAgent: string; platform: string; maxTouchPoints: number; screenWidth: number; screenHeight: number }) {
  return /iPhone|iPod/i.test(device.userAgent) ||
    (/Mac/i.test(device.platform) && device.maxTouchPoints > 1 && Math.min(device.screenWidth, device.screenHeight) <= 500);
}

export const IPHONE = typeof window !== 'undefined' && typeof screen !== 'undefined' && isIPhone({
  userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
  screenWidth: screen.width, screenHeight: screen.height,
});
