export default function field({t}) {
    return [
        {
            type: 'FieldInput',
            field: 'field',
            value: '',
            title: t('form.field'),
            warning: t('warning.field'),
        }, {
            type: 'LanguageInput',
            field: 'title',
            value: '',
            title: t('form.title'),
        }, {
            type: 'LanguageInput',
            field: 'info',
            value: '',
            title: t('form.info'),
        }, {
            type: 'SizeInput',
            field: 'formCreateWrap>labelWidth',
            value: '',
            title: t('form.labelWidth'),
        }, {
            type: 'Struct',
            field: '_control',
            name: 'control',
            value: [],
            title: t('form.control'),
            // 【本地改动 #6，见 ../../VENDOR.md】上游这里挂的是指向 form-create.com 的外链。
            // 本项目不把用户导向上游站点，改为指向工程自带的中文手册（纯文本，不带链接）
            warning: t('form.controlDocument', {doc: t('form.document')}),
            props: {
                defaultValue: [],
                validate(val) {
                    if (!Array.isArray(val)) return false;
                    if (!val.length) return true;
                    return !val.some(({rule}) => {
                        return !Array.isArray(rule);
                    });
                }
            }
        },
    ];
}
