import { DEFAULT_READING_FONT_ID, READING_FONTS } from './fonts';

// A disclosure with ordinary buttons keeps the native Tab/Enter interaction.
// Arrow keys, Home/End and Escape also work within the font menu.
export function installFontPicker(container: HTMLElement, reader: HTMLElement, onChange: () => void): void {
  const storageKey = 'little-reader-font';
  let selected = DEFAULT_READING_FONT_ID;
  try { selected = localStorage.getItem(storageKey) ?? selected; } catch { /* Storage may be disabled. */ }
  if (!READING_FONTS.some(font => font.id === selected)) selected = DEFAULT_READING_FONT_ID;
  const picker = document.createElement('details');
  picker.className = 'font-picker';
  const summary = document.createElement('summary');
  summary.setAttribute('aria-label', 'Reading font');
  const label = document.createElement('span');
  label.textContent = 'Font';
  const current = document.createElement('span');
  current.className = 'current-font';
  summary.append(label, current);
  const options = document.createElement('div');
  options.className = 'font-options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Choose a reading font');
  const buttons = new Map<string, HTMLButtonElement>();
  const choose = (id: string) => {
    const font = READING_FONTS.find(font => font.id === id)!;
    selected = id;
    reader.style.fontFamily = font.family;
    current.style.fontFamily = font.family;
    current.textContent = font.name;
    summary.setAttribute('aria-label', `Reading font: ${font.name}`);
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
    try { localStorage.setItem(storageKey, id); } catch { /* Preference persistence is optional. */ }
    requestAnimationFrame(onChange);
  };
  for (const font of READING_FONTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.font = font.id;
    button.style.fontFamily = font.family;
    button.title = font.description;
    const name = document.createElement('span');
    name.textContent = font.name;
    const sample = document.createElement('span');
    sample.className = 'font-sample';
    sample.textContent = font.sample;
    button.append(name, sample);
    button.addEventListener('click', () => {
      choose(font.id);
      picker.open = false;
      summary.focus();
    });
    buttons.set(font.id, button);
    options.append(button);
    const face = new FontFace(font.faceFamily, `url("${font.src}")`, { weight: '400', style: 'normal', display: 'swap' });
    document.fonts.add(face);
    void face.load().then(() => { if (selected === font.id) requestAnimationFrame(onChange); }).catch(() => {
      button.title = `${font.description} Font unavailable; using a fallback.`;
    });
  }
  picker.append(summary, options);
  container.append(picker);
  choose(selected);
  summary.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      picker.open = true;
      buttons.get(selected)?.focus();
    }
  });
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      picker.open = false;
      summary.focus();
      return;
    }
    const list = [...buttons.values()];
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault();
    list[next].focus();
  });
  document.addEventListener('click', event => {
    if (event.target instanceof Node && !picker.contains(event.target)) picker.open = false;
  });
}
