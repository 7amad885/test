import { create } from "zustand";

export type QualityName = "low" | "medium" | "high" | "ultra";
export type ControlId = "joystick" | "fire" | "fireL" | "ads" | "jump" | "crouch" | "reload" | "sprint";

export interface ControlLayout {
  /** centre position as a fraction of the viewport (0..1) */
  x: number;
  y: number;
  /** size multiplier */
  s: number;
  visible: boolean;
}

export interface Settings {
  quality: "auto" | QualityName;
  fov: number;
  showFps: boolean;
  lookSens: number;
  adsSens: number;
  invertY: boolean;
  joySens: number;
  gamepadSens: number;
  touchOpacity: number;
  buttonScale: number;
  sprintMode: "toggle" | "hold";
  adsMode: "toggle" | "hold";
  crouchMode: "toggle" | "hold";
  autoSprint: boolean;
  floatingJoystick: boolean;
  volume: number;
  layout: Record<ControlId, ControlLayout>;
}

export const DEFAULT_LAYOUT: Record<ControlId, ControlLayout> = {
  joystick: { x: 0.15, y: 0.7, s: 1, visible: true },
  fire: { x: 0.86, y: 0.66, s: 1, visible: true },
  fireL: { x: 0.1, y: 0.36, s: 0.85, visible: true },
  ads: { x: 0.73, y: 0.78, s: 0.9, visible: true },
  jump: { x: 0.94, y: 0.44, s: 0.9, visible: true },
  crouch: { x: 0.94, y: 0.86, s: 0.85, visible: true },
  reload: { x: 0.74, y: 0.52, s: 0.8, visible: true },
  sprint: { x: 0.31, y: 0.86, s: 0.8, visible: true },
};

export const DEFAULT_SETTINGS: Settings = {
  quality: "auto",
  fov: 78,
  showFps: false,
  lookSens: 1,
  adsSens: 0.6,
  invertY: false,
  joySens: 1,
  gamepadSens: 1,
  touchOpacity: 0.75,
  buttonScale: 1,
  sprintMode: "toggle",
  adsMode: "toggle",
  crouchMode: "toggle",
  autoSprint: true,
  floatingJoystick: true,
  volume: 0.8,
  layout: DEFAULT_LAYOUT,
};

const KEY = "paradox-point:settings:v1";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...s, layout: { ...DEFAULT_LAYOUT, ...(s.layout || {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type Screen = "home" | "lobby" | "game";

export interface FeedItem {
  id: number;
  text: string;
  color: string;
  icon?: string;
  t: number;
}

export interface Announcement {
  id: number;
  title: string;
  sub?: string;
  color?: string;
  t: number;
}

interface UIState {
  screen: Screen;
  settings: Settings;
  /** resolved quality preset actually in use */
  quality: QualityName;
  settingsOpen: boolean;
  layoutEditor: boolean;
  touchMode: boolean;
  name: string;
  error: string | null;
  status: string | null;
  feed: FeedItem[];
  announcement: Announcement | null;
  fps: number;
  setScreen: (s: Screen) => void;
  updateSettings: (p: Partial<Settings>) => void;
  setLayout: (id: ControlId, l: Partial<ControlLayout>) => void;
  resetLayout: () => void;
  setQuality: (q: QualityName) => void;
  set: (p: Partial<UIState>) => void;
  pushFeed: (text: string, color: string, icon?: string) => void;
  announce: (title: string, sub?: string, color?: string) => void;
}

let feedId = 1;

export const useUI = create<UIState>((set, get) => ({
  screen: "home",
  settings: loadSettings(),
  quality: "medium",
  settingsOpen: false,
  layoutEditor: false,
  touchMode: typeof window !== "undefined" && (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window),
  name: (typeof localStorage !== "undefined" && localStorage.getItem("paradox-point:name")) || "",
  error: null,
  status: null,
  feed: [],
  announcement: null,
  fps: 0,
  setScreen: (screen) => set({ screen }),
  updateSettings: (p) => {
    const settings = { ...get().settings, ...p };
    localStorage.setItem(KEY, JSON.stringify(settings));
    set({ settings });
  },
  setLayout: (id, l) => {
    const layout = { ...get().settings.layout, [id]: { ...get().settings.layout[id], ...l } };
    get().updateSettings({ layout });
  },
  resetLayout: () => get().updateSettings({ layout: DEFAULT_LAYOUT }),
  setQuality: (quality) => set({ quality }),
  set: (p) => set(p),
  pushFeed: (text, color, icon) => {
    const item = { id: feedId++, text, color, icon, t: performance.now() };
    set({ feed: [...get().feed.slice(-5), item] });
  },
  announce: (title, sub, color) => set({ announcement: { id: feedId++, title, sub, color, t: performance.now() } }),
}));
