// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sigma, the tutorials' mascot: a small robot with a screen for a face, in the theme's colours
 * (primary, surface, text). Its mood (`mood`) changes its face and how it moves.
 *
 *   idle   floats gently, blinks
 *   talk   speaks (its mouth moves)
 *   happy  smiles, its eyes as arcs
 *   cheer  jumps, arms up: a tutorial finished
 *   think  looks up, three dots above its head: it waits for an action
 */
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { LitElement, css, html, svg } from 'lit';
import { property } from 'lit/decorators.js';
import { MSG } from '../i18n.js';
import { defineOnce } from './define.js';
import type { Mood } from './tutorial.js';

export class WuiTutorialsMascot extends LitElement {
  static override readonly styles = css`
    :host {
      display: inline-block;
      width: 96px;
      height: 112px;
      --sigma-body: var(--wui-tutorials-accent, var(--theme-color-primary));
      --sigma-face: var(--wui-tutorials-surface, var(--theme-color-3));
      --sigma-ink: var(--wui-tutorials-ink, var(--theme-color-std-text));
    }
    svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .body,
    .antenna-ball,
    .arm {
      fill: var(--sigma-body);
    }
    .antenna {
      stroke: var(--sigma-body);
      stroke-width: 3;
      stroke-linecap: round;
    }
    .screen {
      fill: var(--sigma-face);
    }
    .eye,
    .dots circle {
      fill: var(--sigma-ink);
    }
    .mouth,
    .eye-arc {
      fill: none;
      stroke: var(--sigma-ink);
      stroke-width: 3;
      stroke-linecap: round;
    }
    .sigma {
      fill: var(--sigma-face);
      font: 700 14px sans-serif;
    }
    .cheek {
      fill: var(--sigma-body);
      opacity: 0.35;
    }
    .whole {
      transform-origin: 50px 100px;
      animation: float 3s ease-in-out infinite;
    }
    .eyes {
      transform-origin: 50px 42px;
      animation: blink 4.5s infinite;
    }
    .mouth {
      transform-origin: 50px 56px;
    }
    .arm {
      transform-box: fill-box;
    }
    .arm.left {
      transform-origin: 100% 0%;
    }
    .arm.right {
      transform-origin: 0% 0%;
    }
    :host([mood='talk']) .mouth {
      animation: talk 0.28s ease-in-out infinite alternate;
    }
    :host([mood='cheer']) .whole {
      animation: jump 0.6s ease-in-out infinite;
    }
    :host([mood='cheer']) .arm.left {
      transform: rotate(120deg);
    }
    :host([mood='cheer']) .arm.right {
      transform: rotate(-120deg);
    }
    :host([mood='think']) .eyes {
      transform: translate(-3px, -3px);
      animation: none;
    }
    .dots circle {
      opacity: 0;
    }
    :host([mood='think']) .dots circle {
      animation: dot 1.2s infinite;
    }
    :host([mood='think']) .dots circle:nth-child(2) {
      animation-delay: 0.2s;
    }
    :host([mood='think']) .dots circle:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes float {
      50% {
        transform: translateY(-4px);
      }
    }
    @keyframes jump {
      50% {
        transform: translateY(-14px) scale(1.04);
      }
    }
    @keyframes blink {
      0%,
      94%,
      100% {
        transform: scaleY(1);
      }
      97% {
        transform: scaleY(0.1);
      }
    }
    @keyframes talk {
      to {
        transform: scaleY(2.2);
      }
    }
    @keyframes dot {
      0%,
      100% {
        opacity: 0.15;
      }
      50% {
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        animation: none !important;
      }
    }
  `;

  @property({ reflect: true }) mood: Mood = 'idle';

  private face() {
    if (this.mood === 'happy' || this.mood === 'cheer') {
      return svg`
        <path class="eye-arc" d="M36 44 q5 -7 10 0" />
        <path class="eye-arc" d="M54 44 q5 -7 10 0" />
        <path class="mouth" d="M40 54 q10 10 20 0" />`;
    }
    return svg`
      <g class="eyes">
        <ellipse class="eye" cx="41" cy="42" rx="4" ry="5" />
        <ellipse class="eye" cx="59" cy="42" rx="4" ry="5" />
      </g>
      ${this.mood === 'think' ? svg`<path class="mouth" d="M44 57 h12" />` : svg`<path class="mouth" d="M43 55 q7 4 14 0" />`}`;
  }

  override render() {
    return html`<svg viewBox="0 0 100 116" role="img" aria-label=${localize(MSG.guide)}>
      <g class="dots">
        <circle cx="70" cy="6" r="3" />
        <circle cx="79" cy="4" r="3" />
        <circle cx="88" cy="2" r="3" />
      </g>
      <g class="whole">
        <line class="antenna" x1="50" y1="22" x2="50" y2="10" />
        <circle class="antenna-ball" cx="50" cy="8" r="5" />
        <rect class="arm left" x="10" y="74" width="10" height="24" rx="5" />
        <rect class="arm right" x="80" y="74" width="10" height="24" rx="5" />
        <rect class="body" x="18" y="22" width="64" height="50" rx="16" />
        <rect class="screen" x="25" y="29" width="50" height="36" rx="10" />
        ${this.face()}
        <circle class="cheek" cx="33" cy="54" r="3.5" />
        <circle class="cheek" cx="67" cy="54" r="3.5" />
        <path class="body" d="M30 72 h40 l-4 30 q-16 8 -32 0 z" />
        <text class="sigma" x="50" y="94" text-anchor="middle">σ</text>
      </g>
    </svg>`;
  }
}

defineOnce('wui-tutorials-mascot', WuiTutorialsMascot);
