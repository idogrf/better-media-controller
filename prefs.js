// SPDX-License-Identifier: GPL-2.0-or-later
// Preferences window: four Adwaita pages (Panel, Popup, Waves, Players). This is
// the only file that may import Gtk, Adw or Gdk.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// One table per choice key: [stored value, label].
const CHOICES = {
    'panel-side': [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
    'element-order': [
        ['icon-label-controls', 'Icon, label, controls'],
        ['label-icon-controls', 'Label, icon, controls'],
        ['controls-icon-label', 'Controls, icon, label'],
    ],
    'icon-mode': [['app', 'App icon'], ['cover', 'Song cover'], ['alternate', 'Alternate between them']],
    'label-show': [['both', 'Title and artist'], ['title', 'Title only'], ['artist', 'Artist only']],
    'popup-effect': [['blur', 'Blurred cover'], ['bleed', 'Cover bleed'], ['glass', 'Glass']],
    'wave-color-mode': [['blue', 'Light blue'], ['cover', 'From the song cover'], ['custom', 'Custom']],
    'player-filter-mode': [
        ['all', 'All players'],
        ['only', 'Only the ticked players'],
        ['except', 'All except the ticked players'],
    ],
};

const hex = c => '#' + [c.red, c.green, c.blue]
    .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

export default class BetterMediaControllerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._settings = settings;
        this._handlerIds = [];

        window.set_default_size(680, 780);
        window.add(this._panelPage());
        window.add(this._popupPage());
        window.add(this._wavesPage());
        window.add(this._playersPage());
        // The settings object outlives the window, so drop the handlers that
        // point at its widgets.
        window.connect('close-request', () => {
            this._handlerIds.forEach(id => settings.disconnect(id));
            this._handlerIds = [];
            return false;
        });
    }

    // Runs fn now and whenever the key changes.
    _watch(key, fn) {
        this._handlerIds.push(this._settings.connect(`changed::${key}`, fn));
        fn();
    }

    // Makes a row sensitive only while predicate(settings) holds.
    _dependsOn(row, key, predicate) {
        this._watch(key, () => {
            row.sensitive = predicate(this._settings);
        });
    }

    _group(title, description) {
        return new Adw.PreferencesGroup({title, description: description ?? ''});
    }

    _page(title, icon, ...groups) {
        const page = new Adw.PreferencesPage({title, icon_name: icon});
        groups.forEach(g => page.add(g));
        return page;
    }

    _comboRow(key, title, subtitle) {
        const table = CHOICES[key];
        const row = new Adw.ComboRow({
            title,
            subtitle: subtitle ?? '',
            model: new Gtk.StringList({strings: table.map(([, label]) => label)}),
        });
        this._watch(key, () => {
            const i = table.findIndex(([value]) => value === this._settings.get_string(key));
            if (i >= 0 && row.selected !== i)
                row.selected = i;
        });
        row.connect('notify::selected', () => {
            const value = table[row.selected]?.[0];
            if (value !== undefined && value !== this._settings.get_string(key))
                this._settings.set_string(key, value);
        });
        return row;
    }

    _spinRow(key, title, subtitle, lower, upper, step, digits = 0) {
        const row = new Adw.SpinRow({
            title,
            subtitle: subtitle ?? '',
            digits,
            adjustment: new Gtk.Adjustment({
                lower, upper, step_increment: step, page_increment: step * 10,
            }),
        });
        this._settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _switchRow(key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle: subtitle ?? ''});
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // A slider with a value label next to it.
    _scaleRow(key, title, subtitle, lower, upper, step, format) {
        const adjustment = new Gtk.Adjustment({
            lower, upper, step_increment: step, page_increment: step * 5,
        });
        const scale = new Gtk.Scale({
            adjustment, draw_value: false, hexpand: true, valign: Gtk.Align.CENTER,
            width_request: 200,
        });
        const label = new Gtk.Label({width_chars: 6, xalign: 1, css_classes: ['numeric']});
        const update = () => {
            label.label = format(adjustment.value);
        };
        adjustment.connect('notify::value', update);
        this._settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        update();
        const row = new Adw.ActionRow({title, subtitle: subtitle ?? ''});
        row.add_suffix(scale);
        row.add_suffix(label);
        return row;
    }

    _colorRow(key, title, subtitle) {
        const button = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog(), valign: Gtk.Align.CENTER});
        this._watch(key, () => {
            const rgba = new Gdk.RGBA();
            if (rgba.parse(this._settings.get_string(key)) && hex(button.rgba) !== hex(rgba))
                button.rgba = rgba;
        });
        button.connect('notify::rgba', () => {
            const value = hex(button.rgba);
            if (value !== this._settings.get_string(key))
                this._settings.set_string(key, value);
        });
        const row = new Adw.ActionRow({title, subtitle: subtitle ?? '', activatable_widget: button});
        row.add_suffix(button);
        return row;
    }

    // Font family only; the reset button goes back to the system font (empty string).
    _fontRow(key, title) {
        const button = new Gtk.FontDialogButton({
            dialog: new Gtk.FontDialog(),
            level: Gtk.FontLevel.FAMILY,
            valign: Gtk.Align.CENTER,
        });
        let loading = false;
        this._watch(key, () => {
            loading = true;
            const family = this._settings.get_string(key);
            if (family === '') {
                button.font_desc = Pango.FontDescription.from_string(Gtk.Settings.get_default().gtk_font_name);
            } else {
                const desc = new Pango.FontDescription();
                desc.set_family(family);
                if (button.font_desc?.get_family() !== family)
                    button.font_desc = desc;
            }
            loading = false;
        });
        button.connect('notify::font-desc', () => {
            const family = button.font_desc?.get_family() ?? '';
            if (!loading && family !== '' && family !== this._settings.get_string(key))
                this._settings.set_string(key, family);
        });
        const reset = new Gtk.Button({
            icon_name: 'edit-clear-symbolic', tooltip_text: 'System default',
            valign: Gtk.Align.CENTER, css_classes: ['flat'],
        });
        reset.connect('clicked', () => this._settings.set_string(key, ''));
        const row = new Adw.ActionRow({title, subtitle: 'The reset button uses the system default', activatable_widget: button});
        row.add_suffix(button);
        row.add_suffix(reset);
        return row;
    }

    _panelPage() {
        const s = this._settings;
        const position = this._group('Position');
        position.add(this._comboRow('panel-side', 'Panel side'));
        position.add(this._spinRow('panel-index', 'Position within side', '0 puts it first', 0, 5, 1));
        position.add(this._comboRow('element-order', 'Element order'));

        const icon = this._group('Icon');
        icon.add(this._comboRow('icon-mode', 'Show'));
        const interval = this._spinRow('icon-interval', 'Switch every', 'Seconds', 2, 120, 1);
        this._dependsOn(interval, 'icon-mode', () => s.get_string('icon-mode') === 'alternate');
        icon.add(interval);
        icon.add(this._spinRow('icon-size', 'Icon size', 'Pixels', 12, 24, 1));

        const label = this._group('Label');
        label.add(this._comboRow('label-show', 'Show'));
        const separator = new Adw.EntryRow({title: 'Separator'});
        s.bind('label-separator', separator, 'text', Gio.SettingsBindFlags.DEFAULT);
        this._dependsOn(separator, 'label-show', () => s.get_string('label-show') === 'both');
        label.add(separator);
        label.add(this._spinRow('label-width', 'Width', 'Pixels', 60, 320, 10));
        label.add(this._spinRow('label-max-length', 'Maximum length', 'Characters before cutting off', 10, 100, 1));
        label.add(this._switchRow('label-scroll', 'Scroll long text'));
        const speed = this._scaleRow('label-scroll-speed', 'Scroll speed', null, 1, 10, 1, v => `${Math.round(v)}`);
        this._dependsOn(speed, 'label-scroll', () => s.get_boolean('label-scroll'));
        label.add(speed);

        const font = this._group('Label font');
        font.add(this._fontRow('label-font', 'Family'));
        font.add(this._spinRow('label-font-size', 'Size', 'Pixels', 9, 20, 0.5, 1));
        font.add(this._switchRow('label-bold', 'Bold'));
        font.add(this._switchRow('label-color-enabled', 'Custom color', "Off uses the panel's text color"));
        const color = this._colorRow('label-color', 'Color');
        this._dependsOn(color, 'label-color-enabled', () => s.get_boolean('label-color-enabled'));
        font.add(color);

        const visibility = this._group('Visibility');
        visibility.add(this._switchRow('hide-when-paused', 'Hide when paused',
            'The pill shrinks away until playback resumes'));
        const after = this._spinRow('hide-delay', 'After', 'Seconds paused', 0, 600, 1);
        this._dependsOn(after, 'hide-when-paused', () => s.get_boolean('hide-when-paused'));
        visibility.add(after);

        return this._page('Panel', 'preferences-desktop-display-symbolic', position, icon, label, font, visibility);
    }

    _popupPage() {
        const background = this._group('Background');
        background.add(this._comboRow('popup-effect', 'Effect'));
        background.add(this._scaleRow('popup-blur', 'Blur', null, 0, 60, 1, v => `${Math.round(v)}px`));

        const shape = this._group('Shape');
        shape.add(this._scaleRow('popup-radius', 'Corner radius', null, 0, 66, 1, v => `${Math.round(v)}px`));
        shape.add(this._scaleRow('popup-width', 'Width', null, 360, 560, 10, v => `${Math.round(v)}px`));

        return this._page('Popup', 'view-list-symbolic', background, shape);
    }

    _wavesPage() {
        const s = this._settings;
        const show = this._group('Show waves on');
        show.add(this._switchRow('wave-pill', 'Panel pill'));
        show.add(this._switchRow('wave-popup', 'Popup'));

        const look = this._group('Look');
        look.add(this._comboRow('wave-color-mode', 'Color'));
        const custom = this._colorRow('wave-custom-color', 'Custom color',
            'Lighter and darker shades are made from it');
        this._dependsOn(custom, 'wave-color-mode', () => s.get_string('wave-color-mode') === 'custom');
        look.add(custom);
        look.add(this._scaleRow('wave-intensity', 'Intensity', 'Wave height and opacity', 20, 150, 5,
            v => `${Math.round(v)}%`));
        look.add(this._scaleRow('wave-speed', 'Speed', null, 25, 200, 5, v => `${Math.round(v)}%`));

        return this._page('Waves', 'audio-x-generic-symbolic', show, look);
    }

    _playersPage() {
        const s = this._settings;
        const gnome = this._group('GNOME');
        gnome.add(this._switchRow('hide-gnome-player', 'Hide the built-in media player',
            'The one in the notification list'));

        const players = this._group('Players', 'Apps that are playing now or have played before.');
        players.add(this._comboRow('player-filter-mode', 'Show'));

        // One row per known player, rebuilt when the list changes.
        let rows = [];
        let syncing = false;
        const rebuild = () => {
            rows.forEach(r => players.remove(r));
            rows = [];
            const known = s.get_strv('known-players');
            if (known.length === 0) {
                const empty = new Adw.ActionRow({title: 'No players have been seen yet'});
                empty.add_css_class('dim-label');
                players.add(empty);
                rows.push(empty);
                return;
            }
            const ticked = s.get_strv('player-filter-list');
            for (const key of known) {
                const check = new Gtk.CheckButton({active: ticked.includes(key), valign: Gtk.Align.CENTER});
                check.connect('toggled', () => {
                    if (syncing)
                        return;
                    const list = s.get_strv('player-filter-list').filter(k => k !== key);
                    if (check.active)
                        list.push(key);
                    s.set_strv('player-filter-list', list);
                });
                const row = new Adw.ActionRow({
                    title: key.charAt(0).toUpperCase() + key.slice(1),
                    activatable_widget: check,
                });
                row.add_suffix(check);
                row._key = key;
                row._check = check;
                players.add(row);
                rows.push(row);
            }
        };
        this._watch('known-players', rebuild);
        this._watch('player-filter-list', () => {
            syncing = true;
            const ticked = s.get_strv('player-filter-list');
            rows.forEach(r => {
                if (r._check && r._check.active !== ticked.includes(r._key))
                    r._check.active = ticked.includes(r._key);
            });
            syncing = false;
        });

        return this._page('Players', 'applications-multimedia-symbolic', gnome, players);
    }
}
