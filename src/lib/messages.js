/*
 * OpenAdBlock - message names shared by the background page and the UI
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The background page owns all state. The popup, options page and content
 * scripts never touch storage directly; they ask through these messages.
 */

export const MSG = Object.freeze({
  // Content script -> background
  GET_COSMETIC: 'cosmetic:get',
  REPORT_HIDDEN: 'cosmetic:report-hidden',
  ADD_USER_FILTER: 'filters:add-user-filter',

  // Popup / options -> background
  GET_POPUP_STATE: 'ui:get-popup-state',
  GET_OPTIONS_STATE: 'ui:get-options-state',
  SET_SETTING: 'ui:set-setting',
  TOGGLE_SITE: 'ui:toggle-site',
  SET_PAUSE: 'ui:set-pause',
  ADD_ALLOWLIST: 'allowlist:add',
  REMOVE_ALLOWLIST: 'allowlist:remove',
  SET_CUSTOM_FILTERS: 'filters:set-custom',
  SET_SUBSCRIPTION_ENABLED: 'subscriptions:set-enabled',
  ADD_SUBSCRIPTION: 'subscriptions:add',
  REMOVE_SUBSCRIPTION: 'subscriptions:remove',
  UPDATE_SUBSCRIPTIONS: 'subscriptions:update',
  GET_LOG: 'log:get',
  CLEAR_LOG: 'log:clear',
  RESET_STATS: 'stats:reset',
  EXPORT_BACKUP: 'backup:export',
  IMPORT_BACKUP: 'backup:import',
  START_PICKER: 'picker:start',

  // Background -> UI
  STATE_CHANGED: 'ui:state-changed'
});

/** Keys the options page is allowed to write through SET_SETTING. */
export const WRITABLE_SETTINGS = Object.freeze([
  'enabled',
  'acceptableAds',
  'collapsePlaceholders',
  'hideCosmetic',
  'showBadge',
  'badgeScope',
  'theme',
  'logEnabled',
  'logLimit',
  'updateIntervalHours'
]);
