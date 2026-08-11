/** Tiny classnames joiner — avoids pulling in `clsx` for something this small. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
