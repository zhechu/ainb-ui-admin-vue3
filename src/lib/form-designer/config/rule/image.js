import {localeProps} from '../../utils';

const label = '图片';
const name = 'elImage';

export default {
    menu: 'aide',
    icon: 'icon-image',
    label,
    name,
    rule() {
        return {
            type: name,
            title: '',
            style: {
                width: '100px',
                height: '100px',
            },
            props: {
                // 【本地改动 #7，见 ../../VENDOR.md】上游默认值是
                // https://static.form-create.com/example.png。这个值会随表单 JSON 落库，
                // 并在生产环境对每个未配置的图片控件发起到上游 CDN 的请求，置空
                src: '',
            }
        };
    },
    props(_, {t}) {
        return localeProps(t, name + '.props', [
            {
                type: 'input',
                field: 'src',
            }
        ]);
    }
};