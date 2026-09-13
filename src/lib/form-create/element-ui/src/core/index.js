import components from '../components';
import parsers from '../parsers';
import alias from './alias';
import manager from './manager';
import FormCreateFactory from '@form-create/core/src/index';
import makers from './maker';
import '../style/index.css';
import extendApi from './api';
import required from './provider';

function install(FormCreate) {
    FormCreate.componentAlias(alias);

    components.forEach(component => {
        FormCreate.component(component.name, component);
    });

    FormCreate.register(required);

    parsers.forEach((parser) => {
        FormCreate.parser(parser);
    });

    Object.keys(makers).forEach(name => {
        FormCreate.maker[name] = makers[name];
    });

    if (typeof window !== 'undefined' && window.ElementPlus) {
        FormCreate.useApp((_, app) => {
            app.use(window.ElementPlus);
        })
    }

}

export default function elmFormCreate() {
    return FormCreateFactory({
        // 【本地改动 #1，见 ../../VENDOR.md】上游这两处写的是 'process.env.UI' /
        // 'process.env.VERSION'，靠 rollup 的 replace 插件在打包时替换。
        // 本工程从源码编译，Vite 的 define 不会替换字符串字面量内部内容，
        // 因此这里硬编码成真值 —— 否则 formCreate.version 会等于字面量
        // "process.env.VERSION"，designer 启动时 compareVersion() 立刻误报。
        ui: 'element-ui',
        version: '3.2.38',
        manager,
        extendApi,
        install,
        attrs: {
            normal: ['col', 'wrap'],
            array: ['className'],
            key: ['title', 'info'],
        }
    });
}
