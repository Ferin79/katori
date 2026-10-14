export const CM_PER_INCH = 2.54;
export const KG_PER_LB = 0.45359237;

export function ftInToCm(ft: number, inches: number): number {
  return Math.round((ft * 12 + inches) * CM_PER_INCH * 10) / 10;
}

export function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalIn = cm / CM_PER_INCH;
  let ft = Math.floor(totalIn / 12);
  let inches = Math.round(totalIn - ft * 12);
  if (inches === 12) {
    ft += 1;
    inches = 0;
  }
  return { ft, in: inches };
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}
