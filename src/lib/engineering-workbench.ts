export type WorkbenchRevision = {
  id: "5.3.8" | "5.3.9 E-K75" | "5.4 FK75";
  label: string;
  role: "historical-controlled" | "frame-authority" | "preferred-front-end";
  status: "controlled" | "development";
  note: string;
};

export type WorkbenchSize = "XS" | "S" | "M" | "L" | "XL";

export type SizeGeometry = {
  size: WorkbenchSize;
  stackMm: number;
  reachMm: number;
  headTubeMm: number;
  headAngleDeg: number;
  seatAngleDeg: number;
  chainstayMm: number;
  bbDropMm: number;
  forkOffsetMm: number;
  axleToCrownStudyMm: number;
  trailMm: number;
  nominalForkTyreClearanceMm: number;
};

export type TubeKey = "DT" | "TT" | "ST" | "CS" | "SS" | "FORK";

export type TubeDefinition = {
  key: TubeKey;
  label: string;
  architecture: string;
  widthMm: number;
  depthMm: number;
  truncationPct: number;
  taperStart: number;
  taperEnd: number;
  rotationDeg: number;
  stations: readonly number[];
};

export type InterfaceControl = {
  id: string;
  label: string;
  requirement: string;
  state: "controlled" | "pending" | "blocked";
  evidence: string;
};

export const WORKBENCH_REVISIONS: readonly WorkbenchRevision[] = [
  {
    id: "5.3.8",
    label: "Rev 5.3.8",
    role: "historical-controlled",
    status: "controlled",
    note: "Historical controlled reference retained for comparison. Do not silently reuse its fork/clearance assumptions.",
  },
  {
    id: "5.3.9 E-K75",
    label: "Rev 5.3.9 E-K75",
    role: "frame-authority",
    status: "development",
    note: "Current frame/rider geometry authority with the retained +8 mm DT/HT correction.",
  },
  {
    id: "5.4 FK75",
    label: "Rev 5.4 FK75",
    role: "preferred-front-end",
    status: "development",
    note: "Preferred fork/front-end development freeze. Not tooling or production release.",
  },
] as const;

/**
 * Current governed E-K75 frame geometry with FK75 front-end development values.
 * These figures come from the controlled Rev 5.4 engineering closure already
 * held in the repository. A-C remains a development study, not production release.
 */
export const CURRENT_SIZE_GEOMETRY: readonly SizeGeometry[] = [
  { size: "XS", stackMm: 520, reachMm: 365, headTubeMm: 85, headAngleDeg: 71.0, seatAngleDeg: 74.5, chainstayMm: 415, bbDropMm: 75, forkOffsetMm: 54.8, axleToCrownStudyMm: 408, trailMm: 60.7, nominalForkTyreClearanceMm: 8.61 },
  { size: "S", stackMm: 538, reachMm: 376, headTubeMm: 100, headAngleDeg: 71.5, seatAngleDeg: 74.0, chainstayMm: 415, bbDropMm: 75, forkOffsetMm: 52.4, axleToCrownStudyMm: 408, trailMm: 60.1, nominalForkTyreClearanceMm: 8.60 },
  { size: "M", stackMm: 555, reachMm: 388, headTubeMm: 120, headAngleDeg: 72.0, seatAngleDeg: 73.7, chainstayMm: 418, bbDropMm: 75, forkOffsetMm: 50.5, axleToCrownStudyMm: 403.285, trailMm: 58.9, nominalForkTyreClearanceMm: 8.37 },
  { size: "L", stackMm: 578, reachMm: 398, headTubeMm: 145, headAngleDeg: 72.3, seatAngleDeg: 73.3, chainstayMm: 420, bbDropMm: 75, forkOffsetMm: 49.9, axleToCrownStudyMm: 401, trailMm: 57.6, nominalForkTyreClearanceMm: 8.18 },
  { size: "XL", stackMm: 602, reachMm: 408, headTubeMm: 170, headAngleDeg: 72.5, seatAngleDeg: 73.0, chainstayMm: 422, bbDropMm: 75, forkOffsetMm: 47.8, axleToCrownStudyMm: 400, trailMm: 58.6, nominalForkTyreClearanceMm: 7.33 },
] as const;

export const TUBE_DEFINITIONS: readonly TubeDefinition[] = [
  { key: "DT", label: "Down Tube", architecture: "VAEA 3.5:1 truncated Kammtail / KVF", widthMm: 52, depthMm: 148, truncationPct: 32, taperStart: 1.0, taperEnd: 0.65, rotationDeg: 0, stations: [0, 20, 40, 60, 80, 100] },
  { key: "TT", label: "Top Tube", architecture: "VAEA 3.2:1 flattened aero ellipse", widthMm: 42, depthMm: 92, truncationPct: 22, taperStart: 1.0, taperEnd: 0.72, rotationDeg: 0, stations: [0, 20, 40, 60, 80, 100] },
  { key: "ST", label: "Seat Tube", architecture: "VAEA 3.0:1 KVF with 27.2 mm seatpost interface zone", widthMm: 46, depthMm: 112, truncationPct: 28, taperStart: 0.82, taperEnd: 1.0, rotationDeg: 0, stations: [0, 20, 40, 60, 80, 100] },
  { key: "CS", label: "Chainstay", architecture: "Asymmetric clearance/load-path section", widthMm: 34, depthMm: 48, truncationPct: 12, taperStart: 1.0, taperEnd: 0.58, rotationDeg: 0, stations: [0, 20, 40, 60, 80, 100] },
  { key: "SS", label: "Seatstay", architecture: "DSS+ dropped-stay section", widthMm: 24, depthMm: 38, truncationPct: 10, taperStart: 0.88, taperEnd: 0.52, rotationDeg: 0, stations: [0, 20, 40, 60, 80, 100] },
  { key: "FORK", label: "Fork", architecture: "FK75 truncated-Kamm crown + tapered blades", widthMm: 42, depthMm: 24, truncationPct: 25, taperStart: 1.0, taperEnd: 0.55, rotationDeg: 0, stations: [0, 20, 40, 60, 80, 100] },
] as const;

export const DATUM_NODES = [
  "BB0",
  "HT Upper",
  "HT Lower",
  "DT-HT",
  "TT-HT",
  "ST-TT",
  "CSND-L",
  "CSND-R",
  "SSND-L",
  "SSND-R",
  "Dropout-L",
  "Dropout-R",
  "Fork Crown",
  "Front Axle",
  "Rear Axle",
] as const;

export const INTERFACE_CONTROLS: readonly InterfaceControl[] = [
  {
    id: "IF-BB",
    label: "Bottom bracket",
    requirement: "T47i internal, 85.5 mm shell width, 0.25 mm facing allowance per side; tool and crank clearance required.",
    state: "controlled",
    evidence: "TC-03 + CAD interface drawing still required for release.",
  },
  {
    id: "IF-HT",
    label: "Headset / steerer",
    requirement: "IS41 upper / IS52 lower, 45×36 bearing seats, tapered 1¼–1½ front-end architecture.",
    state: "pending",
    evidence: "Bearing-seat and stack reconciliation required in controlled CAD.",
  },
  {
    id: "IF-SP",
    label: "Seatpost / clamp",
    requirement: "Ø27.2 mm seatpost interface, insertion depth, clamp zone, slot/gasket detail and local reinforcement.",
    state: "pending",
    evidence: "Section + service-fit verification required.",
  },
  {
    id: "IF-WHL",
    label: "Wheel / tyre",
    requirement: "700C wheel, 25 mm internal rim basis, selectable 28–40 mm tyre envelope and tolerance-aware collision checks.",
    state: "blocked",
    evidence: "TC-04: 700×40 front/rear inflated-tyre clearance not yet released.",
  },
  {
    id: "IF-BRK",
    label: "Brake / rotor",
    requirement: "Flat-mount road disc, 140/160 mm rotor, caliper/rotor/stay/fork collision checks.",
    state: "pending",
    evidence: "Assembly-level CAD and steering/wheel sweep evidence required.",
  },
  {
    id: "IF-DRV",
    label: "Drivetrain / UDH",
    requirement: "12×142 rear, UDH, chainline, chainring/CS, crank/heel, FD/RD and service-clearance checks.",
    state: "pending",
    evidence: "Configured drivetrain assembly required.",
  },
  {
    id: "IF-ROUTE",
    label: "Internal routing",
    requirement: "Brake hoses, Di2 wiring/battery and all penetrations linked to local reinforcement and service extraction.",
    state: "pending",
    evidence: "Penetration register + laminate patch linkage required.",
  },
] as const;

export const MATERIAL_GATES = [
  "Commercial prepreg / resin system",
  "FAW and cured-ply thickness",
  "Density",
  "E1 / E2 / G12 / ν12",
  "Xt / Xc / Yt / Yc / S12",
  "Interlaminar / process allowables",
  "Cure cycle and Tg",
  "Environmental knock-downs",
  "Supplier certificate / revision",
] as const;

export const DEPENDENCY_STAGES = [
  "Geometry",
  "Clearance",
  "Mesh",
  "FEA",
  "Laminate",
  "Manufacturing",
  "Validation",
] as const;
