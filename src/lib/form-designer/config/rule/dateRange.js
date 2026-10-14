import uniqueId from '@form-create/utils/lib/unique';
import {localeOptions, localeProps} from '../../utils';

const label = '日期区间';
const name = 'dateRange';

export default {
    menu: 'main',
    icon: 'icon-date-range',
    label,
    name,
    input: true,
    event: ['change', 'blur', 'focus', 'calendarChange', 'panelChange', 'visibleChange'],
    rule({t}) {
        return {
            // 【本地改动 #5，见 ../../VENDOR.md】上游产出 type: 'datePicker'。
            // 契约里 dateRange 是 valueType=array、storage=delimited（一列存两头），
            // 而 datePicker 是 valueType=date、storage=scalar —— 类型不对齐的后果是
            // 一个数组被当标量往日期列里写，而且全程不报错。渲染器见 registerExtraWidgets.ts
            type: 'dateRange',
            field: uniqueId(),
            title: t('com.dateRange.name'),
            info: '',
            $required: false,
            props: {
                type: 'datetimerange',
            },
        };
    },
    props(_, {t}) {
        return localeProps(t, 'datePicker.props', [{type: 'switch', field: 'readonly'}, {
            type: 'switch',
            field: 'disabled'
        }, {
            type: 'select',
            field: 'type',
            options: localeOptions(t, [
                {label: 'datetimerange', value: 'datetimerange'},
                {label: 'daterange', value: 'daterange'},
                {label: 'monthrange', value: 'monthrange'}
            ])
        }, {
            type: 'switch',
            field: 'clearable',
            value: true
        }, {type: 'switch', field: 'editable', value: true}, {
            type: 'input',
            field: 'startPlaceholder'
        }, {type: 'input', field: 'endPlaceholder'}, {
            type: 'input',
            field: 'format'
        }, {
            type: 'select',
            field: 'align',
            options: localeOptions(t, [{label: 'left', value: 'left'}, {label: 'center', value: 'center'}, {
                label: 'right',
                value: 'right'
            }])
        }, {type: 'input', field: 'rangeSeparator'}, {
            type: 'switch',
            field: 'unlinkPanels'
        }]);
    }
};
