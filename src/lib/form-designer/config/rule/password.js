import uniqueId from '@form-create/utils/lib/unique';
import {localeProps} from '../../utils';

const label = '密码输入框';
const name = 'password';

export default {
    menu: 'main',
    icon: 'icon-password',
    label,
    name,
    input: true,
    event: ['blur', 'focus', 'change', 'input', 'clear'],
    validate: ['string'],
    rule({t}) {
        return {
            // 【本地改动 #5，见 ../../VENDOR.md】上游产出 type: 'input' + props.type='password'。
            // 本项目的控件契约把 password 登记为独立规则类型，并刻意关掉了它的
            // 列表列 / 查询 / 导出三个能力位；类型是 input 的话这三条一条都不生效，
            // 表现为密码字段出现在列表或导出文件里。渲染器见 registerExtraWidgets.ts
            type: 'password',
            field: uniqueId(),
            title: t('com.password.name'),
            info: '',
            $required: false,
            props: {
                type: 'password'
            }
        };
    },
    props(_, {t}) {
        return localeProps(t, name + '.props', [
            {
                type: 'switch',
                field: 'disabled'
            },
            {
                type: 'switch',
                field: 'readonly'
            },
            {
                type: 'inputNumber',
                field: 'maxlength',
                props: {min: 0}
            },
            {
                type: 'input',
                field: 'placeholder'
            },
            {
                type: 'switch',
                field: 'clearable'
            },
        ]);
    }
};
