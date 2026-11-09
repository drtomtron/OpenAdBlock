/*
 * OpenAdBlock - scheduled subscription refresh
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { updateDueSubscriptions } from '../lib/subscriptions.js';

export const UPDATE_ALARM = 'openadblock:update-subscriptions';

/** How often to look for lists that are due. The lists' own expiry decides. */
const CHECK_PERIOD_MINUTES = 60;

/**
 * Install the refresh alarm.
 * @param {() => Promise<void>} afterUpdate called when at least one list changed
 */
export function installSchedule(afterUpdate) {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== UPDATE_ALARM) return;
    const result = await updateDueSubscriptions();
    if (result.updated.length > 0) await afterUpdate();
  });
  rescheduleUpdates();
}

/**
 * (Re)create the alarm. The user's interval preference is applied when
 * deciding whether a list is due, so the alarm period itself is fixed.
 */
export function rescheduleUpdates() {
  browser.alarms.create(UPDATE_ALARM, {
    delayInMinutes: 2,
    periodInMinutes: CHECK_PERIOD_MINUTES
  });
}
