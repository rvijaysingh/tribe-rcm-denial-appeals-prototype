/**
 * Pass A source data: the clinical criteria catalog.
 *
 * Written by hand, not generated, for three reasons:
 * 1. Deterministic by construction, so reruns are stable (PRD 8.2 pass A).
 * 2. No risk of an LLM reproducing real proprietary criteria text (CLAUDE.md).
 * 3. The anti-leakage split is enforced at the source. Each criterion carries
 *    two independent vocabularies:
 *    - `clause`: payer policy language. Loaded into criteria_clauses. Never
 *      shown to the chart generator.
 *    - `strong` / `weak` / `omit`: clinical documentation facts. The only thing
 *      pass C sees. Written in chart voice, not policy voice.
 *    tests/seed/pass-a.test.ts asserts the two share no 6-word phrase.
 *
 * `mention` must appear in a chart whenever the criterion is documented
 * (strong or weak). `forbid` terms must not appear when it is omitted. Pass C
 * checks both deterministically; see text-checks.ts for the matching rules
 * (whole word by default, trailing * for a stem). Only `omittable` criteria
 * can be omitted; the rest are always documented at least weakly, because a
 * chart missing them would not be believable.
 *
 * All clause text is synthetic and uses general clinical thresholds.
 */

import type { Condition, CriteriaStyle } from "../../src/lib/domain";

export interface ClinicalCriterion {
  /** Unique within its condition. */
  key: string;
  omittable: boolean;
  /** Payer policy language, one phrasing per criteria style. */
  clause: Record<CriteriaStyle, string>;
  /** Chart fact when the criterion is strongly supported. */
  strong: string;
  /** Chart fact when support is present but below threshold or ambiguous. */
  weak: string;
  /** Instruction to the chart generator when the criterion is omitted. */
  omit?: string;
  /** Term that must appear in the chart when documented. Also shown to the chart generator verbatim. */
  mention: string;
  /** Terms that must not appear in the chart when omitted. A trailing * marks a stem. */
  forbid: string[];
  /** What a denying payer asserts about this finding. Used for denial letters. */
  payerAssertion: string;
  /** What documentation would satisfy the criterion. Used for needs_docs. */
  evidenceNeeded: string;
}

export const CONDITION_PREFIX: Record<Condition, string> = {
  chf_exacerbation: "CHF",
  sepsis: "SEP",
  copd_exacerbation: "COPD",
  pneumonia: "PNA",
};

export const CONDITION_LABEL: Record<Condition, string> = {
  chf_exacerbation: "CHF exacerbation",
  sepsis: "Sepsis",
  copd_exacerbation: "COPD exacerbation",
  pneumonia: "Community-acquired pneumonia",
};

const CHF: ClinicalCriterion[] = [
  {
    key: "hypoxia",
    omittable: false,
    clause: {
      interqual_style:
        "Admission finding: resting oxygen saturation below 90 percent on room air, OR oxygen at 4 L/min or higher required to hold saturation at 90 percent or above.",
      mcg_style:
        "Inpatient care is supported for hypoxemia at rest, meaning saturation under 90 percent without oxygen or a need for at least 4 liters per minute to maintain 90 percent.",
    },
    strong:
      "SpO2 86% on RA at triage; started on 4L NC with SpO2 up to 91%; remained on 4L NC through hospital day 2.",
    weak: "SpO2 92% on RA at triage; placed on 2L NC for comfort and weaned to RA by the next morning.",
    mention: "SpO2",
    forbid: [],
    payerAssertion:
      "Oxygen saturation at presentation did not show hypoxemia requiring inpatient oxygen therapy.",
    evidenceNeeded:
      "Room air saturation readings at presentation and the oxygen flow rate required over the first 24 hours.",
  },
  {
    key: "iv_diuretic",
    omittable: false,
    clause: {
      interqual_style:
        "Treatment requirement: intravenous loop diuretic given 2 or more times in 24 hours, or as a continuous infusion, after inadequate response to oral dosing.",
      mcg_style:
        "Inpatient admission is supported when repeated or continuous intravenous loop diuretic therapy is needed because oral therapy has not produced adequate diuresis.",
    },
    strong:
      "Furosemide 80 mg IV given in the ED, repeated at 80 mg IV every 12 hours; converted to furosemide infusion at 10 mg/hr on hospital day 2 for urine output under 500 mL.",
    weak: "Furosemide 40 mg IV given once in the ED with good urine output; switched to home oral dose the next morning.",
    mention: "furosemide",
    forbid: [],
    payerAssertion:
      "Diuresis was achieved with a single intravenous dose and could have been managed with oral medication.",
    evidenceNeeded:
      "Medication administration record showing each IV loop diuretic dose and time, and urine output response.",
  },
  {
    key: "bnp",
    omittable: true,
    clause: {
      interqual_style:
        "Laboratory finding: natriuretic peptide above 500 pg/mL (BNP) or above 2,000 pg/mL (NT-proBNP) at presentation.",
      mcg_style:
        "Natriuretic peptide elevation supports admission when the arrival level exceeds 500 pg/mL for BNP or 2,000 pg/mL for the N-terminal form.",
    },
    strong: "BNP 1,480 pg/mL on arrival (prior outpatient value 310 pg/mL).",
    weak: "BNP 410 pg/mL on arrival, similar to prior clinic value of 380 pg/mL.",
    omit: "Do not include any BNP or NT-proBNP result anywhere in the chart.",
    mention: "BNP",
    forbid: ["bnp", "probnp", "nt-probnp", "natriuretic"],
    payerAssertion: "Laboratory values did not show significant cardiac decompensation.",
    evidenceNeeded: "BNP or NT-proBNP result drawn at presentation, with a prior baseline if available.",
  },
  {
    key: "pulm_edema_imaging",
    omittable: true,
    clause: {
      interqual_style:
        "Imaging finding: chest radiograph or CT showing pulmonary vascular congestion, interstitial edema, or new pleural effusions.",
      mcg_style:
        "Admission is supported when chest imaging demonstrates pulmonary edema or new bilateral pleural effusions.",
    },
    strong:
      "Chest x-ray: diffuse bilateral interstitial opacities with cephalization and moderate bilateral effusions, increased from prior study.",
    weak: "Chest x-ray: mild vascular prominence, no definite effusion, no significant change from prior study.",
    omit: "Do not mention any chest x-ray, CT, or other chest imaging.",
    mention: "chest x-ray",
    forbid: ["chest x-ray", "cxr", "radiograph", "ct chest", "imaging"],
    payerAssertion: "Imaging did not demonstrate acute pulmonary edema.",
    evidenceNeeded: "Radiology report for chest imaging performed on arrival.",
  },
  {
    key: "resp_distress",
    omittable: false,
    clause: {
      interqual_style:
        "Clinical finding: breathing faster than 24 per minute, OR accessory muscle use, OR dyspnea at rest.",
      mcg_style:
        "Respiratory distress supports inpatient care when the patient is breathless at rest, uses accessory muscles, or breathes faster than 24 times per minute.",
    },
    strong:
      "Respiratory rate 28 with accessory muscle use; speaking 3 to 4 words per breath; orthopnea requiring 3 pillows.",
    weak: "Respiratory rate 20; reports shortness of breath climbing one flight of stairs; comfortable at rest.",
    mention: "respiratory rate",
    forbid: [],
    payerAssertion: "The patient was not in respiratory distress at rest.",
    evidenceNeeded:
      "Serial respiratory rate and work of breathing documentation from the ED and first hospital day.",
  },
  {
    key: "telemetry_arrhythmia",
    omittable: true,
    clause: {
      interqual_style:
        "Monitoring need: new or uncontrolled arrhythmia requiring continuous cardiac monitoring, such as atrial fibrillation with ventricular rate above 110.",
      mcg_style:
        "Continuous telemetry supports admission when a new or rapid arrhythmia is present, for example atrial fibrillation faster than 110 beats per minute.",
    },
    strong: "New atrial fibrillation with RVR, heart rate 138; started diltiazem drip; on continuous telemetry.",
    weak: "Known chronic atrial fibrillation, rate controlled at 88 on home metoprolol; telemetry ordered.",
    omit: "Do not mention atrial fibrillation, any other arrhythmia, or telemetry monitoring.",
    mention: "atrial fibrillation",
    forbid: ["atrial fibrillation", "afib", "a-fib", "rvr", "arrhythmia", "telemetry", "diltiazem"],
    payerAssertion: "No arrhythmia requiring inpatient monitoring was present.",
    evidenceNeeded: "ECG or telemetry strips and the rhythm documentation that prompted monitoring.",
  },
  {
    key: "renal",
    omittable: true,
    clause: {
      interqual_style:
        "Laboratory finding: serum creatinine increased by 0.3 mg/dL or more above known baseline during the episode.",
      mcg_style:
        "Worsening kidney function, defined as a creatinine rise of at least 0.3 mg/dL over baseline, supports inpatient management.",
    },
    strong:
      "Creatinine 2.1 mg/dL on arrival (baseline 1.3 mg/dL from clinic 2 months ago), 2.4 mg/dL on hospital day 2.",
    weak: "Creatinine 1.4 mg/dL on arrival; no baseline available in the record.",
    omit: "Do not include any creatinine, BUN, eGFR, or other kidney function result, and do not mention kidney disease.",
    mention: "creatinine",
    forbid: ["creatinine", "egfr", "bun", "kidney", "renal", "aki"],
    payerAssertion: "Renal function was at baseline and did not require inpatient monitoring.",
    evidenceNeeded: "Creatinine on arrival and a prior baseline value from outpatient records.",
  },
  {
    key: "failed_outpatient",
    omittable: false,
    clause: {
      interqual_style:
        "History finding: symptoms persisted despite 3 or more days of escalated oral diuretic therapy before presentation.",
      mcg_style:
        "Inpatient care is supported after documented failure of intensified outpatient diuretic treatment lasting at least 3 days.",
    },
    strong:
      "Cardiology clinic doubled home furosemide to 80 mg twice daily 5 days ago; patient reports adherence; weight gain of 4.5 kg over that period with worsening leg swelling.",
    weak: "Patient reports taking extra water pills for a couple of days; weight gain of 1.5 kg by home scale.",
    mention: "weight gain",
    forbid: [],
    payerAssertion: "There was no documented trial of intensified outpatient therapy before admission.",
    evidenceNeeded:
      "Outpatient notes or medication records showing the diuretic dose increase, the dates, and the weight trend.",
  },
  {
    key: "hypotension_perfusion",
    omittable: true,
    clause: {
      interqual_style:
        "Hemodynamic finding: systolic pressure below 90 mmHg with signs of hypoperfusion, or need for intravenous inotropic support.",
      mcg_style:
        "Admission is supported for a low output state: systolic blood pressure under 90 mmHg with poor perfusion, or any inotrope requirement.",
    },
    strong: "BP 84/52, cool mottled extremities; dobutamine started at 2.5 mcg/kg/min as inotrope support.",
    weak: "BP 98/60, extremities warm, mentating normally; no inotrope needed.",
    omit: "Do not mention inotropes, hypoperfusion, or mottled skin.",
    mention: "inotrope",
    forbid: ["dobutamine", "milrinone", "inotrop*", "hypoperfusion", "mottl*"],
    payerAssertion: "The patient was hemodynamically stable.",
    evidenceNeeded: "Serial blood pressures, perfusion exam, and any inotrope orders with start times.",
  },
];

const SEPSIS: ClinicalCriterion[] = [
  {
    key: "lactate_repeat_vitals",
    omittable: true,
    clause: {
      interqual_style:
        "Severity finding: serum lactate of 2 mmol/L or higher, AND a repeat full set of vital signs within 3 hours of fluid resuscitation showing persistent instability.",
      mcg_style:
        "Sepsis severity is supported by lactate at or above 2 mmol/L together with a second complete vital sign set after initial fluids that shows ongoing instability.",
    },
    strong:
      "Lactate 4.2 mmol/L at 02:10, 3.6 mmol/L repeat at 05:30. Post-bolus vitals at 04:45: HR 118, BP 88/50, RR 26, T 38.9 C.",
    weak: "Lactate 2.1 mmol/L at 02:10, not repeated. Vitals at 04:45 after fluids: HR 102, BP 104/62, RR 20.",
    omit:
      "Do not include any lactate result. After the triage vital signs, never record another complete set of vital signs (heart rate, blood pressure, respiratory rate, and temperature together); an isolated blood pressure or heart rate reading is fine. Use normal saline for any fluids, never lactated Ringer's.",
    mention: "lactate",
    forbid: ["lactate", "lactic"],
    payerAssertion:
      "Laboratory and vital sign findings did not show sepsis with persistent instability after initial treatment.",
    evidenceNeeded:
      "Serum lactate result and a full repeat set of vital signs documented after fluid resuscitation.",
  },
  {
    key: "hypotension_map",
    omittable: false,
    clause: {
      interqual_style:
        "Hemodynamic finding: mean arterial pressure below 65 mmHg, or systolic pressure below 90 mmHg, after a 30 mL/kg crystalloid bolus.",
      mcg_style:
        "Inpatient care is supported for hypotension that persists after a 30 mL per kg fluid challenge, with MAP under 65 or systolic under 90 mmHg.",
    },
    strong: "Received 2.5 L normal saline bolus (30 mL/kg); BP after bolus 86/48, MAP 61.",
    weak: "Received 1 L normal saline bolus; BP after bolus 102/64, MAP 77.",
    mention: "bolus",
    forbid: [],
    payerAssertion: "Blood pressure responded to initial fluids without persistent hypotension.",
    evidenceNeeded: "Fluid volumes given with times, and blood pressures recorded after the bolus.",
  },
  {
    key: "vasopressor",
    omittable: true,
    clause: {
      interqual_style:
        "Treatment requirement: vasopressor infusion needed to maintain mean arterial pressure at 65 mmHg or above.",
      mcg_style: "Admission is supported when a vasopressor drip is required to keep MAP at or above 65 mmHg.",
    },
    strong:
      "Norepinephrine started at 04:50 at 0.05 mcg/kg/min, titrated to 0.12 mcg/kg/min to keep MAP above 65.",
    weak: "Norepinephrine discussed by ED team for MAP 64; held after additional fluid with MAP 68.",
    omit: "Do not mention norepinephrine or any vasopressor.",
    mention: "norepinephrine",
    forbid: ["norepinephrine", "vasopressor", "pressor", "levophed", "phenylephrine", "vasopressin"],
    payerAssertion: "No vasopressor support was required.",
    evidenceNeeded: "Medication administration record for any vasopressor, with start time and peak dose.",
  },
  {
    key: "source_infection",
    omittable: false,
    clause: {
      interqual_style:
        "Diagnostic finding: suspected or confirmed infection source documented, with blood cultures obtained before antibiotics.",
      mcg_style:
        "An identified or suspected source of infection, supported by cultures drawn prior to antibiotic therapy, supports inpatient evaluation.",
    },
    strong:
      "Urinalysis with large leukocyte esterase and more than 50 WBC per high power field; blood culture x2 and urine culture drawn at 02:20 before antibiotics; blood culture positive for E. coli at 30 hours.",
    weak: "Source unclear; blood culture x2 drawn at 02:20; urinalysis pending.",
    mention: "culture",
    forbid: [],
    payerAssertion: "An infectious source was not established.",
    evidenceNeeded: "Culture orders with collection times, culture results, and the documented suspected source.",
  },
  {
    key: "organ_dysfunction",
    omittable: true,
    clause: {
      interqual_style:
        "Organ dysfunction finding: creatinine 2.0 mg/dL or higher, OR platelets below 100,000, OR total bilirubin 2.0 mg/dL or higher, new for this episode.",
      mcg_style:
        "New organ dysfunction supports admission: creatinine at least 2.0 mg/dL, a count of platelets under 100,000, or bilirubin of 2.0 mg/dL or more.",
    },
    strong: "Creatinine 2.6 mg/dL (baseline 0.9 mg/dL); platelets 84,000.",
    weak: "Creatinine 1.3 mg/dL (no baseline on file); platelets 162,000.",
    omit: "Do not include creatinine, platelet, or bilirubin results, and do not mention kidney injury.",
    mention: "creatinine",
    forbid: ["creatinine", "platelet", "bilirubin", "aki", "kidney"],
    payerAssertion: "There was no evidence of new organ dysfunction.",
    evidenceNeeded: "Creatinine, platelet count, and bilirubin on arrival, with prior baseline values.",
  },
  {
    key: "mental_status",
    omittable: true,
    clause: {
      interqual_style:
        "Neurologic finding: acute change in mental status from baseline, such as Glasgow Coma Scale below 15.",
      mcg_style: "An acute decline in mentation compared with the patient's usual state supports inpatient care.",
    },
    strong:
      "Daughter reports patient normally independent and oriented; on arrival confused, oriented to self only, GCS 13.",
    weak: "Patient appears tired but answers questions appropriately; GCS 15.",
    omit: "Do not document mental status changes, confusion, or a Glasgow Coma Scale score.",
    mention: "GCS",
    forbid: ["gcs", "glasgow", "confus*", "disoriented", "altered mental", "delirium"],
    payerAssertion: "Mental status was at baseline.",
    evidenceNeeded: "Documented baseline mental status and the arrival neurologic exam with GCS.",
  },
  {
    key: "iv_antibiotics",
    omittable: false,
    clause: {
      interqual_style:
        "Treatment requirement: broad-spectrum intravenous antimicrobials started within 1 hour of recognition and not appropriate for oral substitution within 24 hours.",
      mcg_style:
        "Admission is supported when the patient needs IV broad-spectrum antimicrobials started promptly, with no oral option in the first day.",
    },
    strong:
      "Piperacillin-tazobactam 4.5 g IV given at 02:45, 35 minutes after arrival; vancomycin added; remained on IV antibiotics through day 3.",
    weak: "Ceftriaxone 1 g IV given at 04:30 as the only antibiotic dose; transitioned to oral cephalexin the next morning.",
    mention: "antibiotic",
    forbid: [],
    payerAssertion: "Antibiotic therapy could have been given in an outpatient or observation setting.",
    evidenceNeeded: "Antibiotic administration times relative to arrival and the plan for IV versus oral therapy.",
  },
  {
    key: "sirs_fever_wbc",
    omittable: false,
    clause: {
      interqual_style:
        "Systemic response finding: temperature above 38.3 C or below 36.0 C, AND white blood cell count above 12,000 or below 4,000.",
      mcg_style:
        "A systemic inflammatory response supports sepsis admission when abnormal temperature occurs together with a leukocyte count over 12,000 or under 4,000.",
    },
    strong: "Temperature 39.4 C at triage; WBC 21,300 with 14% bands.",
    weak: "Temperature 37.9 C at triage; WBC 11,200.",
    mention: "WBC",
    forbid: [],
    payerAssertion: "Inflammatory markers did not meet sepsis severity thresholds.",
    evidenceNeeded: "Triage and peak temperatures and the complete blood count with differential.",
  },
  {
    key: "resp_failure",
    omittable: false,
    clause: {
      interqual_style:
        "Respiratory finding: breathing 22 or more per minute with supplemental oxygen of 4 L/min or more, OR PaO2/FiO2 ratio below 300.",
      mcg_style:
        "Respiratory compromise supports inpatient care when breathing is 22 or more per minute and oxygen at 4 liters per minute or higher is needed, or P/F ratio is under 300.",
    },
    strong: "Respiratory rate 30; SpO2 88% on RA, placed on 6L NC with SpO2 93%.",
    weak: "Respiratory rate 22; SpO2 95% on RA, no oxygen needed.",
    mention: "respiratory rate",
    forbid: [],
    payerAssertion: "Respiratory status did not require inpatient-level support.",
    evidenceNeeded: "Respiratory rate, oxygen saturation, and oxygen flow documentation over the first 12 hours.",
  },
];

const COPD: ClinicalCriterion[] = [
  {
    key: "hypoxia_hypercapnia",
    omittable: false,
    clause: {
      interqual_style:
        "Gas exchange finding: oxygen saturation below 88 percent on room air or usual home oxygen, OR arterial pH below 7.35 with PaCO2 above 45 mmHg.",
      mcg_style:
        "Inpatient care is supported for impaired gas exchange: saturation under 88 percent at the patient's usual oxygen level, or acidemia below pH 7.35 with carbon dioxide retention above 45.",
    },
    strong: "SpO2 84% at triage; required 4L NC to reach SpO2 89%.",
    weak: "SpO2 89% at triage; 1L NC started, SpO2 92%.",
    mention: "SpO2",
    forbid: [],
    payerAssertion: "Oxygenation was near baseline and did not require inpatient care.",
    evidenceNeeded: "Triage saturation with the oxygen level at the time, and any blood gas result.",
  },
  {
    key: "abg_acidosis",
    omittable: true,
    clause: {
      interqual_style:
        "Laboratory finding: arterial gas analysis showing respiratory acidosis with pH below 7.35 and carbon dioxide above 50 mmHg.",
      mcg_style:
        "Arterial evidence of acute respiratory acidosis, pH under 7.35 with carbon dioxide tension over 50 mmHg, supports admission.",
    },
    strong: "ABG at 03:15: pH 7.29, PaCO2 64, PaO2 58 on 4L.",
    weak: "ABG at 03:15: pH 7.36, PaCO2 47, PaO2 66 on 2L.",
    omit: "Do not include any arterial or venous blood gas results.",
    mention: "ABG",
    forbid: ["abg", "vbg", "blood gas", "paco2", "pco2", "pao2"],
    payerAssertion: "Blood gas values did not show acute respiratory acidosis.",
    evidenceNeeded: "Arterial blood gas result obtained before or at the start of respiratory support.",
  },
  {
    key: "failed_ed_treatment",
    omittable: false,
    clause: {
      interqual_style:
        "Response finding: inadequate improvement after 3 or more inhaled bronchodilator treatments and a dose of systemic corticosteroid in the emergency department.",
      mcg_style:
        "Admission is supported when wheeze and breathlessness persist after at least 3 nebulized bronchodilator doses plus a systemic steroid given in the ED.",
    },
    strong:
      "Three albuterol-ipratropium nebulizers given in the ED between 01:40 and 03:00 plus methylprednisolone 125 mg IV; persistent diffuse wheeze and dyspnea at rest afterward.",
    weak: "Two albuterol nebulizers in the ED with improved air movement; patient ambulating in hallway before admission decision.",
    mention: "albuterol",
    forbid: [],
    payerAssertion: "Symptoms improved with emergency department treatment.",
    evidenceNeeded: "ED medication administration record and reassessment notes after each bronchodilator treatment.",
  },
  {
    key: "niv",
    omittable: true,
    clause: {
      interqual_style:
        "Treatment requirement: noninvasive positive pressure ventilation initiated for hypercapnia or increased work of breathing.",
      mcg_style:
        "Admission is supported when bilevel or continuous positive airway pressure support is started for ventilatory failure.",
    },
    strong:
      "Placed on BiPAP 14/6 at 03:30 for work of breathing; remained on BiPAP continuously for 9 hours, then nocturnally on night 2.",
    weak: "BiPAP trialed for 40 minutes in the ED, removed for patient comfort; not resumed.",
    omit: "Do not mention BiPAP, CPAP, or any noninvasive ventilation.",
    mention: "BiPAP",
    forbid: ["bipap", "cpap", "noninvasive", "niv", "positive pressure"],
    payerAssertion: "Noninvasive ventilation was not required on a sustained basis.",
    evidenceNeeded: "Respiratory therapy flowsheet showing BiPAP start and stop times and settings.",
  },
  {
    key: "accessory_muscles",
    omittable: false,
    clause: {
      interqual_style:
        "Clinical finding: recruitment of neck and chest wall muscles to breathe, breathing faster than 28 per minute, or inability to speak in full sentences.",
      mcg_style:
        "Increased work of breathing supports inpatient care, including use of neck and chest wall muscles, breathing faster than 28 per minute, or speech limited by breathlessness.",
    },
    strong:
      "Visible accessory muscle use with tripod positioning; respiratory rate 32; speaking 2 to 3 words at a time.",
    weak: "Mild accessory muscle use noted at triage, resolved after first nebulizer; respiratory rate 22.",
    mention: "accessory muscle",
    forbid: [],
    payerAssertion: "Work of breathing was not significantly increased.",
    evidenceNeeded: "Serial respiratory exams documenting work of breathing and respiratory rate.",
  },
  {
    key: "comorbidity",
    omittable: true,
    clause: {
      interqual_style:
        "Comorbidity finding: concurrent decompensation of a significant chronic condition, such as systolic cardiac dysfunction.",
      mcg_style:
        "Inpatient care is supported when a serious comorbid condition, for example reduced systolic cardiac function, is also unstable.",
    },
    strong: "History of heart failure with ejection fraction 30%; bilateral leg edema and 3 kg weight increase this week.",
    weak: "History of heart failure with ejection fraction 50% per echo last year; no edema on exam.",
    omit: "Do not mention heart failure, ejection fraction, or any cardiac history.",
    mention: "ejection fraction",
    forbid: ["ejection fraction", "heart failure", "hfref", "chf", "cardiomyopathy"],
    payerAssertion: "Comorbid conditions were stable.",
    evidenceNeeded: "Documentation of comorbid condition status, such as echo results and exam findings.",
  },
  {
    key: "home_oxygen_escalation",
    omittable: true,
    clause: {
      interqual_style:
        "Oxygen finding: established long-term oxygen user requiring flow at least 2 L/min above usual prescription.",
      mcg_style:
        "For patients on chronic supplemental oxygen, admission is supported when needs rise 2 liters per minute or more above the prescribed amount.",
    },
    strong: "Uses home oxygen 2L continuously; required 5L NC in the ED to maintain target saturation.",
    weak: "Uses home oxygen 2L at night only; on 2L NC during the day in hospital.",
    omit: "Do not mention home oxygen use or a home oxygen prescription.",
    mention: "home oxygen",
    forbid: ["home oxygen", "home o2", "long-term oxygen", "ltot"],
    payerAssertion: "Oxygen requirement was at or near the home prescription.",
    evidenceNeeded: "Home oxygen prescription and the flow rate required during the admission.",
  },
  {
    key: "steroid_iv",
    omittable: false,
    clause: {
      interqual_style:
        "Treatment requirement: systemic corticosteroid therapy requiring intravenous administration or inpatient monitoring.",
      mcg_style:
        "Admission is supported when corticosteroids must be given intravenously or require monitoring, for example for significant hyperglycemia.",
    },
    strong: "IV steroid: methylprednisolone 40 mg IV every 8 hours; glucose rose to 342 requiring insulin sliding scale.",
    weak: "Oral steroid: prednisone 40 mg by mouth daily, tolerated without hyperglycemia.",
    mention: "steroid",
    forbid: [],
    payerAssertion: "Steroid therapy could have been given orally in an outpatient setting.",
    evidenceNeeded: "Steroid orders with route and frequency, and glucose monitoring results.",
  },
  {
    key: "mental_status_hypercapnic",
    omittable: true,
    clause: {
      interqual_style: "Neurologic finding: new reduced alertness or confusion attributed to carbon dioxide retention.",
      mcg_style:
        "Admission is supported when the patient becomes newly hard to keep alert or confused in the setting of CO2 retention.",
    },
    strong: "Somnolent on arrival, arousable to voice but falls asleep mid-sentence; wife reports this is new today.",
    weak: "Somnolent after poor sleep the night before per patient; fully awake and conversant within 1 hour.",
    omit: "Do not describe somnolence, drowsiness, lethargy, or confusion.",
    mention: "somnolent",
    forbid: ["somnolen*", "drows*", "letharg*", "confus*", "obtunded"],
    payerAssertion: "Mental status was at baseline.",
    evidenceNeeded:
      "Arrival neurologic exam, family or facility report of baseline, and a blood gas from the same time window.",
  },
];

const PNEUMONIA: ClinicalCriterion[] = [
  {
    key: "curb65",
    omittable: false,
    clause: {
      interqual_style:
        "Severity finding: CURB-65 score of 2 or higher, or Pneumonia Severity Index class IV or V, documented at admission.",
      mcg_style:
        "Inpatient care is supported for moderate or severe pneumonia by a CURB-65 of at least 2 or a PSI risk class of IV or V.",
    },
    strong: "CURB-65 of 3 documented in the admitting note.",
    weak: "CURB-65 of 1 documented in the admitting note, scored for age only.",
    mention: "CURB-65",
    forbid: [],
    payerAssertion: "Pneumonia severity scores indicated low risk suitable for outpatient treatment.",
    evidenceNeeded: "Severity score calculation with its components, documented at the time of admission.",
  },
  {
    key: "hypoxia",
    omittable: false,
    clause: {
      interqual_style:
        "Oxygenation finding: oxygen saturation below 92 percent on room air, or new supplemental oxygen requirement.",
      mcg_style:
        "Admission is supported when saturation without oxygen falls under 92 percent or the patient newly requires oxygen.",
    },
    strong: "SpO2 87% on RA at triage; placed on 3L NC with SpO2 93%; still on 3L NC on hospital day 2.",
    weak: "SpO2 93% on RA at triage; 1L NC placed overnight for SpO2 91% while sleeping.",
    mention: "SpO2",
    forbid: [],
    payerAssertion: "The patient did not have hypoxemia requiring inpatient oxygen.",
    evidenceNeeded: "Room air saturation at triage and the oxygen requirement over the first 24 hours.",
  },
  {
    key: "imaging_multilobar",
    omittable: false,
    clause: {
      interqual_style: "Imaging finding: infiltrate involving more than one lobe, or associated parapneumonic effusion.",
      mcg_style:
        "Multilobar consolidation or pneumonia with an accompanying pleural effusion supports inpatient management.",
    },
    strong: "Chest x-ray: right lower and right middle lobe infiltrate with small right pleural effusion.",
    weak: "Chest x-ray: patchy right lower lobe infiltrate, no effusion.",
    mention: "infiltrate",
    forbid: [],
    payerAssertion: "Imaging showed limited single-lobe involvement.",
    evidenceNeeded: "Radiology report describing the lobes involved and any effusion.",
  },
  {
    key: "confusion",
    omittable: true,
    clause: {
      interqual_style: "Neurologic finding: new impairment of orientation from baseline.",
      mcg_style: "Newly impaired orientation compared with baseline supports inpatient care.",
    },
    strong: "New confusion per son, who reports patient is normally independent; oriented to self only on arrival.",
    weak: "Possible mild confusion per nurse, slow to respond; son unsure of baseline; oriented on repeat exam.",
    omit: "Do not describe confusion, disorientation, delirium, or altered mental status.",
    mention: "confusion",
    forbid: ["confus*", "disoriented", "delirium", "altered mental"],
    payerAssertion: "Mental status was at baseline.",
    evidenceNeeded: "Documented baseline mental status and the arrival orientation exam.",
  },
  {
    key: "hemodynamic",
    omittable: true,
    clause: {
      interqual_style:
        "Hemodynamic finding: systolic pressure below 90 mmHg or diastolic 60 mmHg or below, requiring intravenous fluid resuscitation.",
      mcg_style:
        "Low blood pressure, systolic under 90 or diastolic at or below 60 mmHg, that requires IV fluid resuscitation supports admission.",
    },
    strong: "Hypotension to 86/54 at triage; 2 L normal saline given; BP after fluids 96/58.",
    weak: "Hypotension to 102/62 at triage attributed to poor oral intake; improved to 118/70 with oral fluids.",
    omit: "Do not document hypotension or any intravenous fluid bolus.",
    mention: "hypotension",
    forbid: ["hypotensi*", "bolus", "normal saline", "fluid resuscitation"],
    payerAssertion: "Blood pressure was stable without need for resuscitation.",
    evidenceNeeded: "Triage and post-fluid blood pressures with fluid volumes and times.",
  },
  {
    key: "failed_oral_antibiotics",
    omittable: true,
    clause: {
      interqual_style:
        "History finding: worsening or no improvement after 48 hours or more of oral antimicrobial therapy before presentation.",
      mcg_style:
        "Inpatient care is supported when at least 48 hours of oral antimicrobials before presentation have failed.",
    },
    strong: "Prior antibiotic: urgent care prescribed doxycycline 4 days ago; took all doses; fever and cough worsened.",
    weak: "Prior antibiotic: leftover amoxicillin started at home yesterday; unclear number of doses.",
    omit: "Do not mention any antibiotic taken before this presentation, or any urgent care visit.",
    mention: "prior antibiotic",
    forbid: ["prior antibiotic", "doxycycline", "amoxicillin", "urgent care", "outpatient antibiotic"],
    payerAssertion: "There was no documented failure of outpatient treatment.",
    evidenceNeeded:
      "Outpatient or urgent care records showing the antibiotic prescribed, the start date, and the response.",
  },
  {
    key: "labs_bun",
    omittable: true,
    clause: {
      interqual_style:
        "Laboratory finding: urea nitrogen above 20 mg/dL, OR serum sodium below 130 mEq/L, OR serum glucose above 250 mg/dL.",
      mcg_style:
        "Metabolic derangement supports admission, meaning urea nitrogen over 20 mg/dL, sodium under 130, or glucose over 250 mg/dL.",
    },
    strong: "BUN 34 mg/dL, sodium 127 mEq/L on arrival.",
    weak: "BUN 21 mg/dL, sodium 134 mEq/L on arrival.",
    omit: "Do not include BUN, sodium, or glucose values.",
    mention: "BUN",
    forbid: ["bun", "sodium", "glucose", "hyponatremia"],
    payerAssertion: "Laboratory values were within acceptable limits.",
    evidenceNeeded: "Basic metabolic panel drawn on arrival.",
  },
  {
    key: "resp_rate",
    omittable: false,
    clause: {
      interqual_style: "Respiratory finding: breathing at 30 or more per minute.",
      mcg_style: "A breathing frequency at or above 30 per minute supports inpatient care for pneumonia.",
    },
    strong: "Respiratory rate 32 at triage, 30 at 4 hours.",
    weak: "Respiratory rate 24 at triage, 20 at 4 hours.",
    mention: "respiratory rate",
    forbid: [],
    payerAssertion: "Respiratory rate was not in the severe range.",
    evidenceNeeded: "Serial respiratory rates from triage through the first 12 hours.",
  },
  {
    key: "iv_antibiotic_need",
    omittable: false,
    clause: {
      interqual_style:
        "Treatment requirement: intravenous antimicrobials without a clinically appropriate oral alternative in the first 24 hours.",
      mcg_style:
        "Admission is supported when IV antimicrobial therapy is needed and oral step-down is not yet appropriate.",
    },
    strong: "Ceftriaxone 1 g IV daily and IV azithromycin; unable to tolerate oral intake due to vomiting through day 2.",
    weak: "Ceftriaxone 1 g IV once in the ED; tolerating oral diet and switched to oral cefpodoxime the next morning.",
    mention: "ceftriaxone",
    forbid: [],
    payerAssertion: "The patient could have been treated with oral antibiotics.",
    evidenceNeeded: "Antibiotic orders with route, and documentation of oral intake tolerance.",
  },
];

export const CATALOG: Record<Condition, ClinicalCriterion[]> = {
  chf_exacerbation: CHF,
  sepsis: SEPSIS,
  copd_exacerbation: COPD,
  pneumonia: PNEUMONIA,
};

/** Look up a criterion. Throws on an unknown key so a typo cannot silently drop a clause. */
export function criterion(condition: Condition, key: string): ClinicalCriterion {
  const found = CATALOG[condition].find((c) => c.key === key);
  if (!found) throw new Error(`Unknown criterion "${key}" for condition "${condition}"`);
  return found;
}
