let locks = 0;
let originalOverflow = "";

/** Native dialogs may overlap briefly during an approval/replacement update. */
export function lockDialogScroll() {
  if (locks === 0) originalOverflow = document.body.style.overflow;
  locks++;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks--;
    if (locks === 0) document.body.style.overflow = originalOverflow;
  };
}
