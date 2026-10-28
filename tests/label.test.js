// SPDX-License-Identifier: GPL-2.0-or-later
import {check, finish} from './assert.js';
import {labelText} from '../label.js';

check('both', labelText('Clocks', 'Coldplay', 'both', ' • ', 40) === 'Clocks • Coldplay');
const long = labelText('The Fate of Ophelia (The Chainsmokers Remix)', 'Taylor Swift', 'both', ' • ', 40);
check('long is 40 chars', long.length === 40);
check('long ends with ellipsis', long.endsWith('…'));
check('hebrew title only', labelText('עבודה עברית', 'להקה מקומית', 'title', ' • ', 40) === 'עבודה עברית');
check('empty artist, both', labelText('Clocks', '', 'both', ' • ', 40) === 'Clocks');
check('artist only', labelText('Clocks', 'Coldplay', 'artist', ' • ', 40) === 'Coldplay');
finish();
