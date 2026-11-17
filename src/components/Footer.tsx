/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlentyLogo } from './Header.tsx';
import { DaySchedule } from '../types.ts';
import { summarizeWeek } from '../utils/schedule.ts';

export const Footer: React.FC<{ weeklySchedule?: DaySchedule[] }> = ({ weeklySchedule }) => {
  const hours = weeklySchedule?.length === 7 ? summarizeWeek(weeklySchedule) : [];
  return (
    <footer className="bg-ink text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-20 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-5">
            <PlentyLogo className="h-28 sm:h-32" lazy />
            <p className="mt-5 text-white/60 max-w-xs leading-relaxed">
              Breakfast, burgers, pasta and Ethiopian favourites, cooked fresh in Addis Ababa.
            </p>
          </div>

          <div className="md:col-span-3">
            <h4 className="text-sm text-white/50 mb-4">Hours</h4>
            <dl className="space-y-2 text-[15px]">
              {hours.map((h) => (
                <div key={h.label} className="flex justify-between gap-4">
                  <dt>{h.label}</dt>
                  <dd className={h.hours ? 'tabular text-white/80' : 'text-white/50'}>{h.hours ?? 'Closed'}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-white/40 mt-3">Addis Ababa time</p>
          </div>

          <div className="md:col-span-2">
            <h4 className="text-sm text-white/50 mb-4">Delivery floors</h4>
            <p className="text-[15px] leading-relaxed">2, 8, 10, 11, 12 and 13</p>
          </div>

          <div className="md:col-span-2">
            <h4 className="text-sm text-white/50 mb-4">Say hello</h4>
            <a
              href="mailto:info@plenty.restaurant"
              className="text-[15px] underline decoration-white/30 underline-offset-4 hover:decoration-white"
            >
              info@plenty.restaurant
            </a>
          </div>
        </div>

        <div className="mt-20 pt-6 border-t border-white/10 flex flex-col sm:flex-row justify-between gap-2 text-sm text-white/40">
          <span>© {new Date().getFullYear()} Plenty Restaurant</span>
          <span>Payments handled securely by Chapa</span>
        </div>
      </div>
    </footer>
  );
};
