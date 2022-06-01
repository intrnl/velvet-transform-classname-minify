import postcss from 'postcss';
import { walker } from '@intrnl/velvet-compiler';

import * as parsel from './parsel.js';


let charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_';

function encode (number, prefix = '') {
	if (number === 0) {
		return charset[0];
	}

	let charset_length = charset.length;
	let result = '';

	while (number > 0) {
		let remainder = number % charset_length;
		number = Math.floor(number / charset_length);
		result = charset[remainder] + result;
	}

	return prefix + result;
}

function classname_minify (opts = {}) {
	const { prefix = '' } = opts;

	return function transform (ast) {
		let class_mapping = Object.create(null);
		let class_conflict = Object.create(null);
		let id_mapping = Object.create(null);
		let id_conflict = Object.create(null);

		let class_num = 0;
		let id_num = 0;

		// grab the <style> element
		let style_node = ast.children.find((node) => node.type === 'Element' && node.name === 'style');

		if (!style_node) {
			return;
		}

		// walk the template and scrape for conflict prevention
		walker.walk(ast, {
			enter (node, parent) {
				if (node.type !== 'Attribute') {
					return;
				}

				let element_name = parent.name;
				let name = node.name;
				let value = node.value;

				let is_class = name === 'class';
				let is_id = name === 'id';
				let is_for = name === 'for' && (element_name === 'label' || element_name === 'output');

				if (!value || !(is_class || is_id || is_for)) {
					return;
				}

				let conflicts = is_class ? class_conflict : id_conflict;

				if (value.type === 'Text') {
					let text = value.decoded;

					let arr = text.split(/\s+/);

					for (let i = 0; i < arr.length; i++) {
						let name = arr[i];
						conflicts[name] = true;
					}

					return;
				}

				if (value.type === 'Expression') {
					let expression = value.expression;

					if (!is_for && expression.type === 'ObjectExpression') {
						let properties = expression.properties;

						for (let idx = 0, len = properties.length; idx < len; idx++) {
							let property = properties[idx];

							if (property.type === 'SpreadProperty') {
								continue;
							}

							let key = property.key;

							// pass: { foo:     123 } Identifier
							// pass: { 'foo':   123 } Literal
							// pass: { ['foo']: 123 } Literal
							// fail: { [foo]:   123 } Identifier

							let key_type = key.type;
							let is_identifier = key_type === 'Identifier';
							let is_literal = key_type === 'Literal';

							if (!(is_literal || (is_identifier && !node.computed))) {
								continue;
							}

							let name = is_literal ? key.value : key.name;

							if (name === '') {
								continue;
							}

							conflicts[name] = true;
						}

						return;
					}

					walker.walk(expression, {
						enter (node, parent) {
							if (parent) {
								if (parent.type === 'ConditionalExpression' && node === parent.test) {
									return walker.SKIP;
								}
							}

							if (node.type === 'Literal' && typeof node.value === 'string') {
								let arr = node.value.split(/\s+/);

								for (let idx = 0, len = arr.length; idx < len; idx++) {
									let name = arr[idx];

									if (name === '') {
										continue;
									}

									conflicts[name] = true;
								}
							}

							if (node.type === 'TemplateElement') {
								let arr = node.value.raw.split(/\s+/);

								for (let idx = 0, len = arr.length; idx < len; idx++) {
									let name = arr[idx];

									if (name === '') {
										continue;
									}

									conflicts[name] = true;
								}
							}
						}
					})

					return;
				}
			},
		});

		// parse the stylesheet
		let style_root = postcss.parse(style_node.children[0].value);

		// walk the stylesheet
		style_root.walkRules((rule) => {
			let sel = parsel.parse(rule.selector);

			parsel.walk(sel, (node) => {
				let is_class = node.type === 'class';
				let is_id = node.type === 'id';

				if (is_class || is_id) {
					let curr_name = node.name;

					let mapping = is_class ? class_mapping : id_mapping;
					let conflicts = is_class ? class_conflict : id_conflict;

					if (curr_name in mapping) {
						node.name = mapping[curr_name];
						return;
					}

					if (curr_name in conflicts) {
						delete conflicts[curr_name];
					}

					let next_name;

					do {
						let num = is_class ? class_num++ : id_num++;
						next_name = encode(num, prefix);
					}
					while (next_name in conflicts);

					mapping[curr_name] = next_name;
					node.name = next_name;
				}
			});

			rule.selector = parsel.stringify(sel);
		});

		style_node.children[0].value = style_root.toString();

		// find-and-replace class and id attributes in the template
		walker.walk(ast, {
			enter (node, parent) {
				if (node.type !== 'Attribute') {
					return;
				}

				let element_name = parent.name;
				let name = node.name;
				let value = node.value;

				let is_class = name === 'class';
				let is_id = name === 'id';
				let is_for = name === 'for' && (element_name === 'label' || element_name === 'output');

				if (!value || !(is_class || is_id || is_for)) {
					return;
				}

				let mapping = is_class ? class_mapping : id_mapping;

				if (value.type === 'Text') {
					let curr_text = value.decoded;
					let arr = curr_text.split(/\s+/);
					let changed = false;

					for (let idx = 0, len = arr.length; idx < len; idx++) {
						let curr_name = arr[idx];

						if (curr_name in mapping) {
							changed = true;
							arr[idx] = mapping[curr_name];
						}
					}

					if (changed) {
						let next_text = arr.join(' ');

						value.value = next_text;
						value.decoded = next_text;
					}

					return;
				}

				if (value.type === 'Expression') {
					let expression = value.expression;

					if (!is_for && expression.type === 'ObjectExpression') {
						let properties = expression.properties;

						for (let idx = 0, len = properties.length; idx < len; idx++) {
							let property = properties[idx];

							if (property.type === 'SpreadProperty') {
								continue;
							}

							let key = property.key;

							// pass: { foo:     123 } Identifier
							// pass: { 'foo':   123 } Literal
							// pass: { ['foo']: 123 } Literal
							// fail: { [foo]:   123 } Identifier

							let key_type = key.type;
							let is_identifier = key_type === 'Identifier';
							let is_literal = key_type === 'Literal';

							if (!(is_literal || (is_identifier && !node.computed))) {
								continue;
							}

							let curr_name = is_literal ? key.value : key.name;

							if (curr_name in mapping) {
								if (is_literal) {
									key.value = mapping[curr_name];
								}
								else {
									key.name = mapping[curr_name];
								}

								property.shorthand = false;
							}
						}

						return;
					}

					walker.walk(expression, {
						enter (node, parent) {
							if (parent) {
								if (parent.type === 'ConditionalExpression' && node === parent.test) {
									return walker.SKIP;
								}
							}

							if (node.type === 'Literal' && typeof node.value === 'string') {
								let arr = node.value.split(/\s+/);
								let changed = false;

								for (let idx = 0, len = arr.length; idx < len; idx++) {
									let curr_name = arr[idx];

									if (curr_name in mapping) {
										changed = true;
										arr[idx] = mapping[curr_name];
									}
								}

								if (changed) {
									node.value = arr.join(' ');
									node.raw = null;
								}
							}

							if (node.type === 'TemplateElement') {
								let arr = node.value.raw.split(/\s+/);
								let changed = false;

								for (let idx = 0, len = arr.length; idx < len; idx++) {
									let curr_name = arr[idx];

									if (curr_name in mapping) {
										changed = true;
										arr[idx] = mapping[curr_name];
									}
								}

								if (changed) {
									node.value.raw = arr.join(' ');
								}
							}
						}
					})

					return;
				}
			},
		});
	}
}

export default classname_minify;
