// Colyseus schema mirrored from MatchSim every tick and delta-patched to clients.
// Fields are `declare`d and initialised in constructors so the schema accessors
// installed by defineTypes are not shadowed by class-field semantics.

import { MapSchema, Schema, defineTypes } from "@colyseus/schema";

export class PlayerState extends Schema {
  declare id: string;
  declare name: string;
  declare side: number;
  declare ready: boolean;
  declare connected: boolean;
  declare ping: number;
  declare kills: number;
  declare deaths: number;
  declare erased: number;
  declare rescued: number;
  declare ammo: number;
  declare reloading: boolean;
  declare unitId: string;
  declare respawnIn: number;
  declare lastSeq: number;
  declare device: string;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.side = 0;
    this.ready = false;
    this.connected = true;
    this.ping = 0;
    this.kills = 0;
    this.deaths = 0;
    this.erased = 0;
    this.rescued = 0;
    this.ammo = 0;
    this.reloading = false;
    this.unitId = "";
    this.respawnIn = 0;
    this.lastSeq = 0;
    this.device = "";
  }
}
defineTypes(PlayerState, {
  id: "string",
  name: "string",
  side: "uint8",
  ready: "boolean",
  connected: "boolean",
  ping: "uint16",
  kills: "uint16",
  deaths: "uint16",
  erased: "uint16",
  rescued: "uint16",
  ammo: "uint8",
  reloading: "boolean",
  unitId: "string",
  respawnIn: "float32",
  lastSeq: "uint32",
  device: "string",
});

export class UnitState extends Schema {
  declare id: string;
  declare side: number;
  declare kind: string;
  declare owner: string;
  declare name: string;
  declare loop: number;
  declare x: number;
  declare y: number;
  declare z: number;
  declare vx: number;
  declare vy: number;
  declare vz: number;
  declare ground: boolean;
  declare yaw: number;
  declare pitch: number;
  declare crouch: boolean;
  declare ads: boolean;
  declare sprint: boolean;
  declare speed: number;
  declare hp: number;
  declare prot: boolean;

  constructor() {
    super();
    this.id = "";
    this.side = 0;
    this.kind = "live";
    this.owner = "";
    this.name = "";
    this.loop = 1;
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.ground = true;
    this.yaw = this.pitch = 0;
    this.crouch = false;
    this.ads = false;
    this.sprint = false;
    this.speed = 0;
    this.hp = 100;
    this.prot = false;
  }
}
defineTypes(UnitState, {
  id: "string",
  side: "uint8",
  kind: "string",
  owner: "string",
  name: "string",
  loop: "uint8",
  x: "float32",
  y: "float32",
  z: "float32",
  vx: "float32",
  vy: "float32",
  vz: "float32",
  ground: "boolean",
  yaw: "float32",
  pitch: "float32",
  crouch: "boolean",
  ads: "boolean",
  sprint: "boolean",
  speed: "float32",
  hp: "uint8",
  prot: "boolean",
});

export class DuelState extends Schema {
  declare code: string;
  declare phase: string;
  declare phaseLeft: number;
  declare round: number;
  declare loop: number;
  declare loopTime: number;
  declare meter: number;
  declare capture: number;
  declare wins0: number;
  declare wins1: number;
  declare lastRoundWinner: number;
  declare matchWinner: number;
  declare endReason: string;
  declare paused: boolean;
  declare pauseLeft: number;
  declare serverTime: number;
  declare players: MapSchema<PlayerState>;
  declare units: MapSchema<UnitState>;

  constructor() {
    super();
    this.code = "";
    this.phase = "lobby";
    this.phaseLeft = 0;
    this.round = 0;
    this.loop = 0;
    this.loopTime = 0;
    this.meter = 0;
    this.capture = -1;
    this.wins0 = 0;
    this.wins1 = 0;
    this.lastRoundWinner = -1;
    this.matchWinner = -1;
    this.endReason = "";
    this.paused = false;
    this.pauseLeft = 0;
    this.serverTime = 0;
    this.players = new MapSchema<PlayerState>();
    this.units = new MapSchema<UnitState>();
  }
}
defineTypes(DuelState, {
  code: "string",
  phase: "string",
  phaseLeft: "float32",
  round: "uint8",
  loop: "uint8",
  loopTime: "float32",
  meter: "float32",
  capture: "int8",
  wins0: "uint8",
  wins1: "uint8",
  lastRoundWinner: "int8",
  matchWinner: "int8",
  endReason: "string",
  paused: "boolean",
  pauseLeft: "float32",
  serverTime: "float64",
  players: { map: PlayerState },
  units: { map: UnitState },
});
