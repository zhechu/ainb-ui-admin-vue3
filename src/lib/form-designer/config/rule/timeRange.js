import uniqueId from '@form-create/utils/lib/unique';
import {localeOptions, localeProps} from '../../utils';

const label = '时间区间';
const name = 'timeRange';

export default {
    menu: 'main',
    icon: 'icon-time-range',
    label,
    name,
    input: true,
    event: ['change', 'blur', 'focus', 'visibleChange'],
    rule({t}) {
        return {
            // 【本地改动 #5，见 ../../VENDOR.md】上游产出 type: 'timePicker'。
            // 同 dateRange：契约里 timeRange 的落库形态与 timePicker 不同，
            // 类型不对齐会静默写坏数据。渲染器见 registerExtraWidgets.ts
            type: 'timeRange',
            field: uniqueId(),
            title: t('com.timeRange.name'),
            info: '',
            $required: false,
            props: {
                isRange: true,
            },
        };
    },
    props(_, {t}) {
        return localeProps(t, 'timePicker.props', [{type: 'switch', field: 'readonly'}, {
            type: 'switch',
            field: 'disabled'
        }, {
            type: 'switch',
            field: 'clearable',
            value: true
        }, {type: 'switch', field: 'editable', value: true}, {
            type: 'input',
            field: 'startPlaceholder'
        }, {type: 'input', field: 'endPlaceholder'}, {
            type: 'switch',
            field: 'arrowControl'
        }, {
            type: 'select',
            field: 'align',
            options: localeOptions(t, [{label: 'left', value: 'left'}, {label: 'center', value: 'center'}, {
                label: 'right',
                value: 'right'
            }])
        }]);
    }
};
