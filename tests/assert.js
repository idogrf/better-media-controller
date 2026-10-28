// SPDX-License-Identifier: GPL-2.0-or-later
// Minimal assertions for the gjs unit tests — no test framework is available
// to plain gjs, and these tests only need equality checks.
import System from 'system';

let failures = 0;

export function check(name, condition) {
    if (condition) {
        print(`ok   ${name}`);
    } else {
        failures++;
        printerr(`FAIL ${name}`);
    }
}

export function near(a, b, eps = 1e-6) {
    return Math.abs(a - b) < eps;
}

export function finish() {
    if (failures > 0) {
        printerr(`${failures} check(s) failed`);
        System.exit(1);
    }
}
