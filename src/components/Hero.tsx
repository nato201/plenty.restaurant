/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowDownRight } from 'lucide-react';
import { DaySchedule } from '../types.ts';
import { openStatusLine } from '../utils/schedule.ts';

interface HeroProps {
  onPreOrderClick: () => void;
  isOrderingEnabled: boolean;
  pauseReason?: string;
  /** Opening hours from the staff portal; the status line is hidden until they've loaded */
  weeklySchedule?: DaySchedule[];
}

export const Hero: React.FC<HeroProps> = ({
  onPreOrderClick,
  isOrderingEnabled,
  pauseReason,
  weeklySchedule,
}) => {
  const statusLine = weeklySchedule?.length === 7 ? openStatusLine(weeklySchedule) : ' ';
  return (
    <section className="relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-14 sm:pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-end">
          <div className="lg:col-span-7 animate-rise">
            <p className="text-sm text-white/60 mb-6 flex items-center gap-3">
              <span className="h-px w-8 bg-accent" />
              {statusLine}
            </p>

            <h1 className="font-display text-[44px] leading-[1.02] sm:text-6xl lg:text-[76px] font-medium text-white tracking-tight">
              More than
              <br />
              a <em className="text-accent font-normal">meal.</em>
            </h1>

            <p className="mt-6 text-[17px] sm:text-lg text-white/75 max-w-md leading-relaxed">
              Skip the lunchtime queue. Order breakfast, burgers, pasta or tibs ahead,
              and we'll bring it hot to your floor, or have your table ready.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row sm:items-center gap-4">
              {isOrderingEnabled ? (
                <button
                  onClick={onPreOrderClick}
                  className="group inline-flex items-center justify-center gap-3 bg-accent hover:bg-accent-dark text-white text-[15px] font-medium pl-7 pr-6 h-13 rounded-full transition-colors"
                >
                  Pre-order now
                  <ArrowDownRight
                    className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5"
                    strokeWidth={2}
                  />
                </button>
              ) : (
                <div className="max-w-md border-l-2 border-saffron pl-4 py-1 text-[15px] text-white/90">
                  <span className="font-medium">We're not taking orders right now.</span>{' '}
                  <span className="text-white/60">
                    {pauseReason || 'The kitchen will be back shortly.'}
                  </span>
                </div>
              )}
              <span className="text-sm text-white/50">Pay with telebirr, CBE Birr or card</span>
            </div>
          </div>

          <div className="lg:col-span-5 animate-rise [animation-delay:120ms]">
            <figure className="relative">
              <div className="aspect-[6/5] sm:aspect-square lg:aspect-[4/5] rounded-t-[999px] rounded-b-3xl overflow-hidden bg-ink-2 ring-1 ring-white/10">
                <img
                  src="https://images.unsplash.com/photo-1600565193348-f74bd3c7ccdf?w=1100&auto=format&fit=crop&q=80"
                  alt="A chef flame-cooking in the Plenty kitchen"
                  width={1100}
                  height={1375}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="w-full h-full object-cover object-[30%_center]"
                />
              </div>
              <figcaption className="absolute -bottom-5 left-4 sm:-left-6 bg-ink-2/95 backdrop-blur border border-white/10 rounded-2xl px-5 py-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.5)]">
                <span className="block text-xs text-white/50">Every plate</span>
                <span className="block font-display text-lg text-white">Cooked to order</span>
                <span className="block text-sm text-accent">never sitting under a lamp</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </div>

      <div className="border-y border-white/10 bg-white/[0.03]">
        <dl className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
          {[
            ['Delivery to', 'Floors 2, 8, 10, 11, 12 & 13'],
            ['Or dine in', 'A table ready at your time'],
            ['Order ahead', 'Up to 7 days in advance'],
          ].map(([label, value]) => (
            <div key={label} className="py-4 sm:py-5 sm:px-6 first:sm:pl-0 flex sm:block items-baseline justify-between gap-4">
              <dt className="text-xs text-white/50">{label}</dt>
              <dd className="text-[15px] text-white sm:mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};
