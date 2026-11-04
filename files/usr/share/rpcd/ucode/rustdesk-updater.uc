#!/usr/bin/env ucode
'use strict';

import { popen, access } from 'fs';

const BASE = '/opt/rustdesk-updater';
const BACKUPS = BASE + '/backups';
const UPDATER = '/usr/libexec/rustdesk-updater';
const SCHEDULE = '/usr/libexec/rustdesk-updater-schedule';

/*
 * Выполняет команду и отдельно получает её код завершения.
 * Не полагается на результат popen.close().
 */
function execute(cmd) {
	let p = popen(
		'(' + cmd + '); rc=$?; printf "\\n__RUSTDESK_RC__%s\\n" "$rc"',
		'r'
	);

	if (!p)
		return {
			success: false,
			output: 'Не удалось запустить команду',
			exit_code: -1
		};

	let raw = p.read('all') ?? '';
	p.close();

	raw = trim(raw);

	let marker = split(raw, '\n');
	if (!length(marker))
		return {
			success: false,
			output: 'Не удалось получить результат команды',
			exit_code: -1
		};

	let last = marker[length(marker) - 1];

	if (!match(last, /^__RUSTDESK_RC__[0-9]+$/))
		return {
			success: false,
			output: raw || 'Команда не вернула результат',
			exit_code: -1
		};

	let code = int(replace(last, /^__RUSTDESK_RC__/, ''));
	let output = replace(raw, '\n' + last, '');

	return {
		success: code == 0,
		output: trim(output),
		exit_code: code
	};
}

function shellquote(value) {
	return "'" + replace('' + value, "'", "'\\''") + "'";
}

function validDate(value) {
	return type(value) == 'string' &&
		match(value, /^[0-9]{8}$/);
}

function validVersion(value) {
	return type(value) == 'string' &&
		match(value, /^[0-9]+\.[0-9]+\.[0-9]+$/);
}

function configValue(option, fallback) {
	let result = execute(
		'uci -q get rustdesk-updater.main.' + option
	);

	return result.success && result.output != '' ?
		result.output : fallback;
}

function stateValue(key, fallback) {
	const allowed = [
		'checked_at',
		'hbbs_version',
		'hbbr_version',
		'latest_version',
		'sha256',
		'status',
		'message'
	];

	if (index(allowed, key) < 0)
		return fallback;

	let result = execute(
		"jq -r '." + key + " // empty' " +
		shellquote(BASE + '/last-check.json') +
		' 2>/dev/null'
	);

	return result.success && result.output != '' ?
		result.output : fallback;
}

function binaryVersion(path) {
	if (!access(path))
		return 'не найден';

	let result = execute(shellquote(path) + ' --version 2>&1');

	return result.output || (
		result.success ? 'неизвестно' : 'ошибка получения версии'
	);
}

function background(cmd) {
	let result = execute(
		'nohup ' + cmd +
		' >/dev/null 2>&1 </dev/null &'
	);

	return result;
}

function backupExists(version) {
	if (!validVersion(version))
		return false;

	let dir = BACKUPS + '/' + version;

	return execute(
		'[ -s ' + shellquote(dir + '/hbbs') + ' ] && ' +
		'[ -s ' + shellquote(dir + '/hbbr') + ' ] && ' +
		'[ -s ' + shellquote(dir + '/hbbs.sha256') + ' ] && ' +
		'[ -s ' + shellquote(dir + '/hbbr.sha256') + ' ] && ' +
		'[ "$(cat ' + shellquote(dir + '/version') +
		' 2>/dev/null)" = ' + shellquote(version) + ' ] && ' +
		'h1=$(sha256sum ' + shellquote(dir + '/hbbs') + ') && ' +
		'h1=${h1%% *} && ' +
		'h2=$(sha256sum ' + shellquote(dir + '/hbbr') + ') && ' +
		'h2=${h2%% *} && ' +
		'[ "$h1" = "$(cat ' + shellquote(dir + '/hbbs.sha256') + ')" ] && ' +
		'[ "$h2" = "$(cat ' + shellquote(dir + '/hbbr.sha256') + ')" ]'
	).success;
}

const methods = {
	get_status: {
		call: function() {
			let hbbs = execute('pidof hbbs');
			let hbbr = execute('pidof hbbr');

			return {
				hbbs_version: binaryVersion('/usr/bin/hbbs'),
				hbbr_version: binaryVersion('/usr/bin/hbbr'),
				hbbs_running: hbbs.success && hbbs.output != '',
				hbbr_running: hbbr.success && hbbr.output != '',
				running: hbbs.success && hbbs.output != '' &&
					hbbr.success && hbbr.output != '',

				last_check_time: stateValue('checked_at', 'Проверок пока нет'),
				last_check_hbbs: stateValue('hbbs_version', '—'),
				last_check_hbbr: stateValue('hbbr_version', '—'),
				latest_version: stateValue('latest_version', '—'),
				last_check_sha256: stateValue('sha256', '—'),
				last_check_status: stateValue('status', 'unknown'),
				last_check_message: stateValue('message', '—'),

				enabled: configValue('enabled', '1'),
				auto_update: configValue('auto_update', '1'),
				frequency: configValue('frequency', 'daily'),
				hour: configValue('hour', '3'),
				minute: configValue('minute', '0'),
				weekday: configValue('weekday', '1')
			};
		}
	},

	get_backups: {
		call: function() {
			let result = execute(
				'for d in ' + shellquote(BACKUPS) + '/*/; do ' +
				'[ -d "$d" ] || continue; ' +
				'v=${d%/}; v=${v##*/}; ' +
				'case "$v" in ""|*[!0-9.]*) continue;; esac; ' +
				'[ -s "$d/hbbs" ] && [ -s "$d/hbbr" ] || continue; ' +
				'[ "$(cat "$d/version" 2>/dev/null)" = "$v" ] || continue; ' +
				'echo "$v"; done | sort -Vr | head -n 3'
			);

			return {
				success: result.success,
				output: result.output
			};
		}
	},

	get_backups_details: {
		call: function() {
			let result = execute(
				'for d in ' + shellquote(BACKUPS) + '/*/; do ' +
				'[ -d "$d" ] || continue; ' +
				'v=${d%/}; v=${v##*/}; ' +
				'case "$v" in ""|*[!0-9.]*) continue;; esac; ' +
				'[ "$(cat "$d/version" 2>/dev/null)" = "$v" ] || continue; ' +
				'[ -s "$d/hbbs" ] && [ -s "$d/hbbr" ] || continue; ' +
				'h1=$(sha256sum "$d/hbbs") || continue; h1=${h1%% *}; ' +
				'h2=$(sha256sum "$d/hbbr") || continue; h2=${h2%% *}; ' +
				'e1=$(cat "$d/hbbs.sha256" 2>/dev/null) || continue; ' +
				'e2=$(cat "$d/hbbr.sha256" 2>/dev/null) || continue; ' +
				'[ "$h1" = "$e1" ] && [ "$h2" = "$e2" ] || continue; ' +
				'echo "$v|$h1|$h2"; done | sort -r'
			);

			return {
				success: result.success,
				output: result.output
			};
		}
	},

	run_action: {
		args: {
			action: 'action'
		},

		call: function(req) {
			let action = req.args?.action;

			if (action == 'check') {
				let result = execute(
					shellquote(UPDATER) + ' check 2>&1'
				);

				return {
					success: result.success,
					output: result.output,
					exit_code: result.exit_code
				};
			}

			if (action == 'update') {
				let result = background(
					shellquote(UPDATER) + ' update'
				);

				return {
					success: result.success,
					output: result.success ?
						'Обновление запущено' : result.output
				};
			}

			return {
				success: false,
				output: 'Недопустимое действие'
			};
		}
	},

	rollback_version: {
		args: {
			version: 'version'
		},

		call: function(req) {
			let version = req.args?.version;

			if (!validVersion(version))
				return {
					success: false,
					output: 'Некорректный номер версии'
				};

			if (!backupExists(version))
				return {
					success: false,
					output: 'Резервная копия не найдена или повреждена'
				};

			let result = background(
				shellquote(UPDATER) + ' rollback ' +
				shellquote(version)
			);

			return {
				success: result.success,
				output: result.success ?
					'Откат на версию ' + version + ' запущен' :
					result.output
			};
		}
	},

	get_log: {
		args: {
			date: 'date'
		},

		call: function(req) {
			let date = req.args?.date;

			if (!validDate(date))
				return {
					success: false,
					output: 'Неверная дата'
				};

			let path = BASE + '/updater' + date + '.log';

			if (!access(path))
				return {
					success: true,
					output: '',
					message: 'За эту дату журнал отсутствует'
				};

			let result = execute(
				'tail -n 200 ' + shellquote(path)
			);

			return {
				success: result.success,
				output: result.output
			};
		}
	},

};

return {
        'luci.rustdesk-updater': methods
};
