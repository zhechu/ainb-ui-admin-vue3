/**
 * 给子表控件的属性面板加上「合计行」配置
 *
 * 做法与 useOptionSource / useValidateRule 一致：拦截内置属性规则再追加。
 *
 * <h3>为什么行数限制不在这里加</h3>
 *
 * 子表的行数区间用的是内核自带的 `min` / `max` 属性（B5 已确认）。
 * 自造 minRows / maxRows 会让「界面上限制了、服务端却读不到」——
 * 这种「配了但不生效」比没有校验更糟，交接文档里已经记过一次教训。
 */
import { Ref } from 'vue'
import { SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'
import { TITLE_WIDGET_TYPE } from '@/components/FormWidgets/collapseGroup'
import { TABS_WIDGET_TYPE } from '@/components/FormWidgets/stepValidate'
import { appendComponentProps } from '../designer/useComponentPropsRegistry'

export const useSubTableRule = (designer: Ref) => {
  const buildSubTableRule = () => {
    appendComponentProps(
      designer,
      SUB_TABLE_WIDGET_TYPE,
      () => [
        {
          type: 'SubTableSummaryField',
          field: '__subTableSummary__',
          title: '合计行',
          props: {}
        }
      ],
      'SubTableRule'
    )
  }

  /**
   * 给内置的分组标题加「可折叠」
   *
   * 不新增折叠面板控件（设计方案 §5.3）—— 用户眼里标题和折叠面板是同一件东西，
   * 多一个控件只会多一次「我该用哪个」的犹豫。
   *
   * 折叠范围是「本标题之后、下一个标题之前的同级控件」，与画布上看到的分组一致。
   */
  const buildTitleRule = () => {
    appendComponentProps(
      designer,
      TITLE_WIDGET_TYPE,
      () => [
        {
          type: 'switch',
          field: 'collapsible',
          title: '可折叠',
          info: '折叠范围是本标题之后、下一个标题之前的控件'
        },
        {
          type: 'switch',
          field: 'defaultCollapsed',
          title: '默认折叠',
          info: '用户手动展开/收起后会被记住，下次以他的选择为准'
        }
      ],
      'SubTableRule'
    )
  }

  /**
   * 给标签页容器加「分步校验」
   *
   * 也就是步骤条要的那条核心能力：当前页校验不过就不许往后走。
   * 独立的步骤条控件要做成设计器可识别的容器（每一步一个落点），
   * 是另一个量级的工作 —— 而「分步」真正稀缺的部分是这条校验，不是那个横条。
   */
  const buildTabsRule = () => {
    appendComponentProps(
      designer,
      TABS_WIDGET_TYPE,
      () => [
        {
          type: 'switch',
          field: 'stepValidate',
          title: '分步校验',
          info: '当前页的字段校验不通过时，不允许切到后面的页；往回退不受限制'
        }
      ],
      'SubTableRule'
    )
  }

  return { buildSubTableRule, buildTitleRule, buildTabsRule }
}
