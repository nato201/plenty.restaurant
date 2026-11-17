/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowUpRight } from 'lucide-react';

const STEPS = [
  {
    n: '01',
    title: 'Pick your dishes',
    body: 'Add plates and extras to your bag. Leave a note if you want it your way.',
  },
  {
    n: '02',
    title: 'Choose a time, delivery or dine-in',
    body: 'Book a 15-minute slot, today or up to a week ahead. We deliver to floor 2, 8, 10, 11, 12 or 13, or you can eat at the restaurant.',
  },
  {
    n: '03',
    title: 'Pay, then enjoy',
    body: 'Pay in birr with telebirr, CBE Birr or card. We start cooking so it’s hot and on time.',
  },
];

/** Decorative olive branch, drawn in line */
const Branch: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 120 160" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className={className} aria-hidden="true">
    <path d="M20 150C45 110 70 70 100 12" />
    {[
      [32, 128, -1], [44, 108, 1], [55, 90, -1], [66, 72, 1], [77, 54, -1], [88, 34, 1],
    ].map(([x, y, s], i) => (
      <path
        key={i}
        d={`M${x} ${y}c${s * 14} -4 ${s * 22} -14 ${s * 22} -24c${-s * 12} 2 ${-s * 20} 10 ${-s * 22} 24Z`}
      />
    ))}
  </svg>
);

export const HowItWorks: React.FC<{ onStart: () => void; isOrderingEnabled: boolean }> = ({
  onStart,
  isOrderingEnabled,
}) => {
  return (
    <section className="relative overflow-hidden bg-paper text-ink">
      <Branch className="absolute -left-6 bottom-0 w-40 h-52 text-accent/30 pointer-events-none" />
      <Branch className="absolute -right-4 -top-6 w-32 h-44 text-accent/20 rotate-180 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="text-sm text-accent mb-4">Pre-order</p>
            <h2 className="font-display text-4xl sm:text-5xl font-medium leading-[1.05] tracking-tight">
              Your favourites,
              <br />
              <em className="text-accent font-normal">minus the wait.</em>
            </h2>
            <p className="mt-5 text-ink/70 max-w-sm leading-relaxed">
              Order between meetings and walk down when it’s ready. No line, no guessing.
            </p>
            {isOrderingEnabled && (
              <button
                onClick={onStart}
                className="mt-8 inline-flex items-center gap-2 bg-accent hover:bg-accent-dark text-white font-medium px-6 h-12 rounded-full transition-colors"
              >
                Start an order
                <ArrowUpRight className="w-4 h-4" />
              </button>
            )}
          </div>

          <ol className="lg:col-span-7 divide-y divide-ink/10 border-y border-ink/10">
            {STEPS.map((s) => (
              <li key={s.n} className="py-7 grid grid-cols-[3.5rem_1fr] gap-4">
                <span className="font-display text-2xl text-accent tabular">{s.n}</span>
                <div>
                  <h3 className="font-display text-2xl">{s.title}</h3>
                  <p className="mt-1.5 text-ink/65 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};
