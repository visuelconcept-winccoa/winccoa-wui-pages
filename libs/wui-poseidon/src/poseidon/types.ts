// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Live sensor values keyed by "group.field" path (e.g. "inlet.flow"). */
export type SensorValues = Record<string, number>;

/** Live runtime of one equipment, keyed by id. */
export interface EquipmentState {
  state: number; // EQ_STOPPED | EQ_RUNNING | EQ_FAULT
  mode: number; // MODE_MANUAL | MODE_AUTO
  feedback: number; // % load
  current: number; // A
  runningHours: number;
}

export type EquipmentStates = Record<string, EquipmentState>;

/** Operator control operations exposed by the backend. */
export type ControlAction = 'start' | 'stop' | 'auto' | 'manual';

/** A derived alarm (threshold breach or equipment fault). */
export interface Alarm {
  /** Stable key so the same condition keeps one row across refreshes. */
  id: string;
  kind: 'threshold' | 'fault';
  source: string;
  message: string;
  value: string;
  severity: 'high' | 'warn';
  /** ISO time the condition was first seen. */
  since: string;
  acknowledged: boolean;
}

/** One archived sample of a trend signal. */
export interface TrendSample {
  t: number; // epoch ms
  v: number;
}

/** Backend KPI summary (from GET /api/poseidon/kpi). */
export interface KpiSummary {
  efficiencies: { key: string; percent: number }[];
  conformity: { key: string; value: number; limit: number; unit: string; pass: boolean }[];
  specificEnergy: number;
}
