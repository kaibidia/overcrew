/**
 * Curated control-name vocabulary.
 *
 * Names are separate from interaction types (docs/DECISIONS.md D21). A name
 * carries the visible label plus the set of interaction types it may take — the
 * model deliberately does NOT assume "one name = one type forever" — but we also
 * do not want nonsense pairings, so `compatibleTypes` is hand-curated.
 *
 * Pools are approved manually, in small batches, so the spoken vocabulary stays
 * funny, memorable and phonetically distinct under noisy gameplay. Do not
 * auto-generate large pools here.
 */
import {
  createControl,
  type ControlDefinition,
  type ControlInstance,
  type ControlType,
} from "./model";

export interface ControlNameDef {
  /** Stable id, referenced by ControlInstance.nameId. */
  id: string;
  /** Visible name players shout. */
  label: string;
  /** Interaction types this name may be instantiated as. At least one. */
  compatibleTypes: readonly ControlType[];
}

/**
 * Approved `button` pool. Five names, one interaction, deliberately different
 * sound profiles (avoid "X СБРОС / Y СБРОС / Z СБРОС" families — too alike when
 * shouted). All five reuse the single button component and behaviour.
 */
export const BUTTON_NAMES = [
  { id: "plazmonasos", label: "ПЛАЗМОНАСОС", compatibleTypes: ["button"] },
  { id: "avariyny_sbros", label: "АВАРИЙНЫЙ СБРОС", compatibleTypes: ["button"] },
  { id: "ionny_puskatel", label: "ИОННЫЙ ПУСКАТЕЛЬ", compatibleTypes: ["button"] },
  { id: "kvantovy_zvonok", label: "КВАНТОВЫЙ ЗВОНОК", compatibleTypes: ["button"] },
  { id: "turbostarter", label: "ТУРБОСТАРТЕР", compatibleTypes: ["button"] },
  { id: "kvantovy_ogurets", label: "КВАНТОВЫЙ ОГУРЕЦ", compatibleTypes: ["button"] },
  { id: "gravibudilnik", label: "ГРАВИБУДИЛЬНИК", compatibleTypes: ["button"] },
] as const satisfies readonly ControlNameDef[];

/**
 * Names for the other types. PROVISIONAL — the `toggle` / `shapeSelector` pools
 * below were expanded for Stage 3 so a 2–5-player game has enough distinct
 * labels; they still need a proper spoken-vocabulary review (DECISIONS D37).
 * Compatibility is set where a name plausibly fits more than one interaction
 * (ДАВЛЕНИЕ: slider/dial; ФАЗОВРАЩАТЕЛЬ: dial/toggle).
 */
export const OTHER_NAMES = [
  // toggle
  { id: "krioklapan", label: "КРИОКЛАПАН", compatibleTypes: ["toggle"] },
  { id: "neytronny_kran", label: "НЕЙТРОННЫЙ КРАН", compatibleTypes: ["toggle"] },
  { id: "orbitalny_zamok", label: "ОРБИТАЛЬНЫЙ ЗАМОК", compatibleTypes: ["toggle"] },
  { id: "magnitny_zatvor", label: "МАГНИТНЫЙ ЗАТВОР", compatibleTypes: ["toggle"] },
  { id: "termokontur", label: "ТЕРМОКОНТУР", compatibleTypes: ["toggle"] },
  // shapeSelector
  { id: "turbozhaba", label: "ТУРБОЖАБА", compatibleTypes: ["shapeSelector"] },
  { id: "gravimetr", label: "ГРАВИМЕТР", compatibleTypes: ["shapeSelector"] },
  { id: "vektorny_zazhim", label: "ВЕКТОРНЫЙ ЗАЖИМ", compatibleTypes: ["shapeSelector"] },
  { id: "sinhrofazotron", label: "СИНХРОФАЗОТРОН", compatibleTypes: ["shapeSelector"] },
  // direction / slider / dial / hold / mash — one example each, pending approval
  { id: "giroskop", label: "ГИРОСКОП", compatibleTypes: ["direction"] },
  { id: "davlenie", label: "ДАВЛЕНИЕ", compatibleTypes: ["slider", "dial"] },
  { id: "fazovrashchatel", label: "ФАЗОВРАЩАТЕЛЬ", compatibleTypes: ["dial", "toggle"] },
  { id: "stabilizator", label: "СТАБИЛИЗАТОР", compatibleTypes: ["hold"] },
  { id: "impulsator", label: "ИМПУЛЬСАТОР", compatibleTypes: ["mash"] },
] as const satisfies readonly ControlNameDef[];

export const CONTROL_NAMES: readonly ControlNameDef[] = [
  ...BUTTON_NAMES,
  ...OTHER_NAMES,
];

export function getControlName(id: string): ControlNameDef | undefined {
  return CONTROL_NAMES.find((n) => n.id === id);
}

/** Names that may be instantiated as `type`. */
export function namesForType(type: ControlType): ControlNameDef[] {
  return CONTROL_NAMES.filter((n) => n.compatibleTypes.includes(type));
}

/** True if `nameId` exists and lists `type` among its compatible types. */
export function isCompatible(nameId: string, type: ControlType): boolean {
  return getControlName(nameId)?.compatibleTypes.includes(type) ?? false;
}

/**
 * Registry-aware constructor: resolves the label from `nameId` and refuses a
 * definition whose type the name does not allow.
 */
export function instantiateControl(
  id: string,
  nameId: string,
  definition: ControlDefinition,
  ownerPlayerId?: string,
): ControlInstance {
  const name = getControlName(nameId);
  if (!name) throw new Error(`Unknown control name id: ${nameId}`);
  if (!name.compatibleTypes.includes(definition.kind)) {
    throw new Error(
      `Control "${name.label}" cannot be a ${definition.kind} ` +
        `(allowed: ${name.compatibleTypes.join(", ")})`,
    );
  }
  return createControl(id, { nameId, label: name.label }, definition, ownerPlayerId);
}
