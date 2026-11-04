'use strict';
'require view';
'require form';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'luci.rustdesk-updater',
	method: 'get_status',
	expect: {}
});

var callBackups = rpc.declare({
	object: 'luci.rustdesk-updater',
	method: 'get_backups_details',
	expect: {}
});

var callAction = rpc.declare({
	object: 'luci.rustdesk-updater',
	method: 'run_action',
	params: ['action'],
	expect: {}
});

var callRollback = rpc.declare({
	object: 'luci.rustdesk-updater',
	method: 'rollback_version',
	params: ['version'],
	expect: {}
});

var callLog = rpc.declare({
	object: 'luci.rustdesk-updater',
	method: 'get_log',
	params: ['date'],
	expect: {}
});

function notify(message, type) {
	ui.addTimeLimitedNotification(
		null, E('p', {}, [String(message || '')]), 5000, type || 'info'
	);
}

function clearNode(node) {
	while (node.firstChild)
		node.removeChild(node.firstChild);
}

function addText(parent, tag, className, value) {
	var el = E(tag, { 'class': className || '' }, [
		String(value == null ? '—' : value)
	]);
	parent.appendChild(el);
	return el;
}

function makeButton(label, action, className, extra) {
	var attrs = {
		'class': className || 'btn',
		'type': 'button',
		'data-rdu-action': action
	};

	if (extra) {
		Object.keys(extra).forEach(function(key) {
			attrs[key] = extra[key];
		});
	}

	return E('button', attrs, [label]);
}

function formatDate(date) {
	var y = date.getFullYear();
	var m = String(date.getMonth() + 1).padStart(2, '0');
	var d = String(date.getDate()).padStart(2, '0');

	return '' + y + m + d;
}

function localDate(date) {
	return date.toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: 'long',
		year: 'numeric'
	});
}

function statusLine(label, value) {
	return E('div', { 'class': 'rdu-status-row' }, [
		E('span', { 'class': 'rdu-label' }, [label]),
		E('strong', {}, [String(value == null ? '—' : value)])
	]);
}

function renderStatus(container, status) {
	clearNode(container);

	if (!status) {
		addText(container, 'p', 'error', _('Не удалось получить состояние сервера'));
		return;
	}

	var services = E('div', { 'class': 'rdu-grid' });

	[
		{ name: 'HBBS', version: status.hbbs_version, running: status.hbbs_running },
		{ name: 'HBBR', version: status.hbbr_version, running: status.hbbr_running }
	].forEach(function(item) {
		var card = E('div', { 'class': 'rdu-card' });

		addText(card, 'h3', '', item.name);
		card.appendChild(statusLine(_('Версия'), item.version));
		card.appendChild(statusLine(_('Состояние'),
			item.running ? _('Работает') : _('Остановлен')));

		services.appendChild(card);
	});

	container.appendChild(services);

	var details = E('div', { 'class': 'rdu-card rdu-details' });
	addText(details, 'h3', '', _('Последняя проверка'));

	details.appendChild(statusLine(_('Дата'), status.last_check_time));
	details.appendChild(statusLine(_('HBBS'), status.last_check_hbbs));
	details.appendChild(statusLine(_('HBBR'), status.last_check_hbbr));
	details.appendChild(statusLine(_('Последняя версия'), status.latest_version));
	details.appendChild(statusLine(_('Результат'), status.last_check_status));
	details.appendChild(statusLine(_('SHA256'), status.last_check_sha256));

	if (status.last_check_message)
		addText(details, 'p', 'rdu-message', status.last_check_message);

	container.appendChild(details);

	var actions = E('div', { 'class': 'rdu-actions' });
	actions.appendChild(makeButton(_('Проверить обновления'), 'check', 'btn'));
	actions.appendChild(makeButton(_('Установить обновление'), 'update', 'btn cbi-button-action'));

	container.appendChild(actions);
}

function renderBackups(container, result) {
	clearNode(container);

	if (!result || !result.success) {
		addText(container, 'p', 'error',
			result && result.output ? result.output : _('Не удалось получить резервные копии'));
		return;
	}

	var lines = String(result.output || '').trim().split(/\r?\n/).filter(Boolean);

	if (!lines.length) {
		addText(container, 'p', 'rdu-muted', _('Резервных копий пока нет'));
		return;
	}

	var table = E('table', { 'class': 'table rdu-backup-table' });
	var head = E('tr', { 'class': 'tr' });

	['Версия', 'SHA256 HBBS', 'SHA256 HBBR', 'Действие'].forEach(function(label) {
		head.appendChild(E('th', { 'class': 'th' }, [label]));
	});

	table.appendChild(E('thead', {}, [head]));

	var body = E('tbody');

	lines.forEach(function(line) {
		var parts = line.split('|');

		if (parts.length !== 3 || !/^\d+\.\d+\.\d+$/.test(parts[0]))
			return;

		var row = E('tr', { 'class': 'tr' });

		row.appendChild(E('td', { 'class': 'td' }, [parts[0]]));
		row.appendChild(E('td', { 'class': 'td rdu-hash' }, [parts[1]]));
		row.appendChild(E('td', { 'class': 'td rdu-hash' }, [parts[2]]));

		var action = E('td', { 'class': 'td' });
		action.appendChild(makeButton(_('Откатить'), 'rollback',
			'btn', { 'data-version': parts[0] }));

		row.appendChild(action);
		body.appendChild(row);
	});

	table.appendChild(body);
	container.appendChild(table);
}

function renderLogs(container, selectedDate, result) {
	clearNode(container);

	var dates = E('div', { 'class': 'rdu-date-list' });
	var now = new Date();

	for (var i = 0; i < 10; i++) {
		var date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
		var key = formatDate(date);
		var label = i === 0 ? _('Сегодня') :
			(i === 1 ? _('Вчера') :
			(i === 2 ? _('Позавчера') : localDate(date)));

		dates.appendChild(makeButton(label, 'log-date',
			key === selectedDate ? 'btn cbi-button-action' : 'btn',
			{ 'data-date': key }));
	}

	container.appendChild(dates);

	var output = E('pre', {
		'class': 'rdu-log-output',
		'id': 'rdu-log-output'
	});

	if (!result) {
		output.textContent = _('Выберите дату для просмотра журнала');
	}
	else if (!result.success) {
		output.textContent = result.output || _('Ошибка загрузки журнала');
	}
	else {
		output.textContent = result.output || result.message ||
			_('За эту дату журнал отсутствует');
	}

	container.appendChild(output);
}

return view.extend({
	load: function() {
		var today = formatDate(new Date());

		return Promise.all([
			callStatus().catch(function() { return null; }),
			callBackups().catch(function() { return null; }),
			callLog(today).catch(function(err) {
				return {
					success: false,
					output: String(err)
				};
			})
		]);
	},

	render: function(data) {
		var status = data[0];
		var backups = data[1];
		var selectedDate = formatDate(new Date());
		var currentLog = data[2];

		var m = new form.Map('rustdesk-updater',
			_('RustDesk Server Updater'),
			_('Управление обновлениями RustDesk Server'));

		var s = m.section(form.NamedSection, 'main', 'updater');
		s.addremove = false;

		s.tab('updater', _('Updater'));
		s.tab('auto', _('Auto Update'));
		s.tab('schedule', _('Schedule'));
		s.tab('backups', _('Backups'));
		s.tab('logs', _('Logs'));

		var o;

		o = s.taboption('updater', form.DummyValue, '_status',
			_('Состояние сервера'));
		o.rawhtml = true;
		o.default = '<div id="rdu-status"></div>';

		o = s.taboption('auto', form.Flag, 'enabled',
			_('Автоматический режим'),
			_('Разрешает запуск автоматического механизма обновлений.'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('auto', form.Flag, 'auto_update',
			_('Автоматическая установка'),
			_('Разрешает автоматическую установку найденной версии.'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('schedule', form.ListValue, 'frequency',
			_('Частота'));
		o.value('disabled', _('Отключено'));
		o.value('daily', _('Ежедневно'));
		o.value('weekly', _('Еженедельно'));
		o.default = 'daily';
		o.rmempty = false;

		o = s.taboption('schedule', form.ListValue, 'hour',
			_('Час запуска'));
		for (var h = 0; h < 24; h++)
			o.value(String(h), String(h).padStart(2, '0') + ':00');
		o.default = '3';
		o.rmempty = false;
		o.depends('frequency', 'daily');
		o.depends('frequency', 'weekly');

		o = s.taboption('schedule', form.ListValue, 'weekday',
			_('День недели'));
		[
			['1', _('Понедельник')],
			['2', _('Вторник')],
			['3', _('Среда')],
			['4', _('Четверг')],
			['5', _('Пятница')],
			['6', _('Суббота')],
			['7', _('Воскресенье')]
		].forEach(function(item) {
			o.value(item[0], item[1]);
		});
		o.default = '1';
		o.rmempty = false;
		o.depends('frequency', 'weekly');

		o = s.taboption('backups', form.DummyValue, '_backups',
			_('Резервные копии'));
		o.rawhtml = true;
		o.default = '<div id="rdu-backups"></div>';

		o = s.taboption('logs', form.DummyValue, '_logs',
			_('Журнал обновлений'));
		o.rawhtml = true;
		o.default = '<div id="rdu-logs"></div>';

		return m.render().then(function(node) {
			node.insertBefore(E('link', {
				'rel': 'stylesheet',
				'href': L.resource('view/rustdesk-updater/segments.css')
			}), node.firstChild);

			var statusNode = node.querySelector('#rdu-status');
			var backupsNode = node.querySelector('#rdu-backups');
			var logsNode = node.querySelector('#rdu-logs');

			if (statusNode)
				renderStatus(statusNode, status);

			if (backupsNode)
				renderBackups(backupsNode, backups);

			if (logsNode)
				renderLogs(logsNode, selectedDate, currentLog);

			node.addEventListener('click', function(ev) {
				var button = ev.target.closest('[data-rdu-action]');

				if (!button || !node.contains(button))
					return;

				var action = button.getAttribute('data-rdu-action');

				if (action === 'check' || action === 'update') {
					button.disabled = true;
					button.classList.add('spinning');

					callAction(action).then(function(result) {
						notify(result.output || _('Запрос выполнен'),
							result.success ? 'info' : 'error');

						if (action === 'check') {
							return callStatus().then(function(value) {
								status = value;
								renderStatus(statusNode, status);
							});
						}
					}).catch(function(err) {
						notify(String(err), 'error');
					}).finally(function() {
						button.disabled = false;
						button.classList.remove('spinning');
					});

					return;
				}

				if (action === 'rollback') {
						var version = button.getAttribute('data-version');

						if (!confirm(_('Запустить откат на версию ') + version + '?'))
								return;

						button.disabled = true;

						function delay(ms) {
								return new Promise(function(resolve) {
										setTimeout(resolve, ms);
								});
						}

						function refreshRollbackViews(current) {
								status = current;

								if (statusNode)
										renderStatus(statusNode, status);

								return callBackups().then(function(value) {
										backups = value;

										if (backupsNode)
												renderBackups(backupsNode, backups);
								}).catch(function(err) {
										if (backupsNode)
												renderBackups(backupsNode, null);

										notify(_('Не удалось обновить список резервных копий: ') +
											String(err), 'error');
								});
						}

						callStatus().then(function(before) {
								if (!before)
										throw new Error(_('Не удалось получить исходное состояние'));

								var beforeState = JSON.stringify([
										before.last_check_time,
										before.last_check_status,
										before.last_check_message
								]);

								return callRollback(version).then(function(result) {
										if (!result || !result.success) {
											notify(result && result.output ?
												result.output : _('Не удалось запустить откат'), 'error');
											return;
										}

										notify(result.output || _('Откат запущен'), 'info');

										var startedAt = Date.now();

										function pollRollback() {
											if (Date.now() - startedAt >= 120000) {
												return callStatus().then(function(current) {
													return refreshRollbackViews(current);
												}).then(function() {
													notify(
														_('Время ожидания отката истекло. Проверьте состояние сервера и журнал.'),
														'error'
													);
												}).catch(function(err) {
													notify(_('Не удалось проверить результат отката: ') +
														String(err), 'error');
													});
											}

											return callStatus().then(function(current) {
												var currentState = JSON.stringify([
														current.last_check_time,
														current.last_check_status,
														current.last_check_message
													]);

												if (currentState === beforeState ||
														current.last_check_status === 'rolling_back') {
													return delay(2000).then(pollRollback);
												}

												var state = current.last_check_status;

												if (['rolled_back', 'error', 'up_to_date'].indexOf(state) < 0)
													return delay(2000).then(pollRollback);

												return refreshRollbackViews(current).then(function() {
													var success =
														(state === 'rolled_back' || state === 'up_to_date') &&
														current.hbbs_version === version &&
														current.hbbr_version === version &&
														current.running;

													if (success) {
														notify(_('Откат на версию ') + version +
															_(' завершён успешно'), 'info');
													} else {
														notify(
															current.last_check_message ||
															_('Откат завершился, но проверка версии или процессов не пройдена'),
															'error'
														);
													}
												});
											}).catch(function() {
												return delay(2000).then(pollRollback);
											});
										}

										return delay(1000).then(pollRollback);
								});
						}).catch(function(err) {
								notify(String(err), 'error');
						}).finally(function() {
								button.disabled = false;
						});

						return;
					}

				if (action === 'log-date') {
					selectedDate = button.getAttribute('data-date');
					button.disabled = true;

					callLog(selectedDate).then(function(result) {
						currentLog = result;
						renderLogs(logsNode, selectedDate, currentLog);
					}).catch(function(err) {
						currentLog = {
							success: false,
							output: String(err)
						};
						renderLogs(logsNode, selectedDate, currentLog);
					});
				}
			});

			return node;
		});
	}
});
