import { createElement, memo, useMemo, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  BlockContent,
  DefinitionContent,
  List as ListNode,
  Paragraph,
  PhrasingContent,
  Root,
  Table as TableNode,
} from 'mdast'
import { CitationLink } from '../search/CitationLink.js'
import { CodeBlock } from './CodeBlock.js'
import { ImageAsLink, Link } from './Link.js'
import { InlineMath, MathBlock } from './MathFormula.js'

const Html = memo(function Html({ value }: { value: string }) {
  if (/^<br\s*\/?>$/i.test(value)) {
    return <br />
  }
  return <span className="ds-markdown-html">{value}</span>
})

const List = memo(function List({ node, loading }: { node: ListNode; loading: boolean }) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag start={node.ordered ? node.start || undefined : undefined}>
      {node.children.map((child, index) => {
        // GFM: task item 的 checked 为 boolean；普通 listItem 为 null
        const checked = child.checked
        const isTaskItem = typeof checked === 'boolean'
        return (
          <li key={index} className={isTaskItem ? 'ds-markdown-task-list-item' : undefined}>
            {isTaskItem ? (
              // □ U+25A1 / ☑ U+2611
              <span className="ds-markdown-task-checkbox">{checked ? '☑  ' : '□  '}</span>
            ) : null}
            <MarkdownBlockContentOrDefinitionContent nodes={child.children} loading={loading} />
          </li>
        )
      })}
    </ListTag>
  )
})

const Table = memo(function Table({ node }: { node: TableNode }) {
  const columnCount = node.children[0]?.children.length
  return (
    <div className="markdown-table-wrapper">
      <table>
        {node.children[0] ? (
          <thead>
            <tr>
              {node.children[0].children.map((cell, cellIndex) => {
                return (
                  <th key={cellIndex}>
                    <MarkdownPhrasingContent nodes={cell.children} />
                  </th>
                )
              })}
            </tr>
          </thead>
        ) : null}
        {node.children[1] ? (
          <tbody>
            {node.children.slice(1).map((row, rowIndex) => {
              const curColumnCount = row.children.length || 0
              return (
                <tr key={rowIndex}>
                  {row.children.map((cell, cellIndex) => {
                    return (
                      <td key={cellIndex}>
                        <MarkdownPhrasingContent nodes={cell.children} />
                      </td>
                    )
                  })}
                  {/* 补齐到列数 */}
                  {Array.from({ length: columnCount - curColumnCount }).map((_, idx) => (
                    <td key={`ptd_${idx}`} />
                  ))}
                </tr>
              )
            })}
          </tbody>
        ) : null}
      </table>
    </div>
  )
})

const MarkdownPhrasingContent = memo(function MarkdownPhrasingContent({
  nodes,
}: {
  nodes: PhrasingContent[]
}) {
  return (
    <>
      {nodes.map((node, index) => {
        return <MarkdownPhrasingContentItem key={index} node={node} />
      })}
    </>
  )
})

const MarkdownPhrasingContentItem = memo(function MarkdownPhrasingContentItem({
  node,
}: {
  node: PhrasingContent
}) {
  switch (node.type) {
    case 'inlineMath':
      return <InlineMath value={node.value} />
    case 'break':
      return <br />
    case 'emphasis':
      return (
        <em>
          <MarkdownPhrasingContent nodes={node.children} />
        </em>
      )
    case 'image':
      return <ImageAsLink node={node} />
    case 'html':
      return <Html value={node.value} />
    case 'inlineCode':
      return <code>{node.value}</code>
    case 'link':
      return (
        <Link node={node}>
          <MarkdownPhrasingContent nodes={node.children} />
        </Link>
      )
    case 'strong':
      return (
        <strong>
          <MarkdownPhrasingContent nodes={node.children} />
        </strong>
      )
    case 'text':
      return <TextContent>{node.value}</TextContent>
    case 'citation':
      return <CitationLink source={node.source} />
    default:
      // 删除线、脚注、引用式链接已在解析时换成文本
      return null
  }
})

// 按 \n 拆行插 <br>：源文每个换行（含软换行）都渲染为视觉换行
const TextContent = memo(function TextContent({ children }: { children: string }) {
  const result: ReactNode[] = []
  children.split(/\r?\n/).forEach((line, index) => {
    result.push(<span key={index + 's'}>{line}</span>, <br key={index + 'br'} />)
  })
  result.pop()
  return result
})

const MarkdownBlockContentOrDefinitionContent = memo(
  function MarkdownBlockContentOrDefinitionContent({
    nodes,
    loading,
    a11yKeyPrefix,
  }: {
    nodes: Array<BlockContent | DefinitionContent>
    loading: boolean
    a11yKeyPrefix?: string
  }) {
    return nodes.map((node, index) => {
      switch (node.type) {
        case 'math':
          return <MathBlock key={index} value={node.value} />
        case 'thematicBreak':
          return <hr key={index} />
        case 'blockquote':
          return (
            <blockquote key={index}>
              <MarkdownBlockContentOrDefinitionContent nodes={node.children} loading={loading} />
            </blockquote>
          )
        case 'html':
          return <Html key={index} value={node.value} />
        case 'heading':
          return node.children.length === 0
            ? null
            : createElement(
                `h${node.depth}`,
                { key: index },
                <MarkdownPhrasingContent nodes={node.children} />
              )
        case 'paragraph':
          {
            const proxyable =
              a11yKeyPrefix !== undefined &&
              node.children.every((child) =>
                ['break', 'emphasis', 'inlineCode', 'strong', 'text'].includes(child.type)
              )
          return (
            <p
              key={index}
              className="ds-markdown-paragraph"
              data-android-a11y={
                proxyable ? `${a11yKeyPrefix}-paragraph-${index}` : undefined
              }
              data-android-a11y-label={proxyable ? paragraphText(node) : undefined}
              data-android-a11y-label-kind={proxyable ? 'selfText' : undefined}
              data-android-a11y-role={proxyable ? 'textView' : undefined}
              data-android-a11y-checkable={proxyable ? 'false' : undefined}
              data-android-a11y-clickable={proxyable ? 'false' : undefined}
              data-android-a11y-focusable={proxyable ? 'false' : undefined}
            >
              <MarkdownPhrasingContent nodes={node.children} />
            </p>
          )
          }
        case 'code':
          return (
            <CodeBlock
              key={index}
              code={node.value}
              infostring={node.lang || 'text'}
              loading={loading}
            />
          )
        case 'table':
          return <Table node={node} key={index} />
        case 'list':
          return <List key={index} node={node} loading={loading} />
        default:
          // 脚注与定义已在解析时换成段落
          return null
      }
    })
  }
)

const phrasingText = (node: PhrasingContent): string => {
  switch (node.type) {
    case 'break':
      return '\n'
    case 'citation':
      return ''
    case 'emphasis':
    case 'link':
    case 'strong':
      return node.children.map(phrasingText).join('')
    case 'html':
      return node.value
    case 'image':
      return node.alt ?? ''
    case 'inlineCode':
    case 'inlineMath':
    case 'text':
      return node.value
    default:
      return ''
  }
}

const paragraphText = (node: Paragraph) => node.children.map(phrasingText).join('')

export const MarkdownAstRenderer = memo(function MarkdownAstRenderer({
  ast,
  className,
  a11yKeyPrefix,
  loading = false,
}: {
  ast: Root
  className?: string
  a11yKeyPrefix?: string
  loading?: boolean
}) {
  const simpleParagraphs = ast.children.every(
    (node) =>
      node.type === 'paragraph' &&
      node.children.every((child) =>
        ['break', 'emphasis', 'inlineCode', 'strong', 'text'].includes(child.type)
      )
  )
  return useMemo(
    () => (
      <div className={clsx('ds-markdown', className)}>
        {/* 解析器在根节点下产出块级内容。 */}
        <MarkdownBlockContentOrDefinitionContent
          nodes={ast.children as Array<BlockContent | DefinitionContent>}
          a11yKeyPrefix={simpleParagraphs ? a11yKeyPrefix : undefined}
          loading={loading}
        />
      </div>
    ),
    [a11yKeyPrefix, className, ast.children, loading, simpleParagraphs]
  )
})
