from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re


def rich(text):
    text = escape(text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", text)


def detail_id(label):
    return "detail-" + label.split()[0].lower()


def table_row(line, tag):
    cells = "".join(f"<{tag}>{rich(cell.strip())}</{tag}>" for cell in line.split("|")[1:-1])
    return f"<tr>{cells}</tr>"


def render_section(lines):
    lines = iter(lines)
    next_line = next(lines, None)
    output = []
    while next_line is not None:
        line = next_line
        next_line = next(lines, None)
        if not line:
            continue
        if line.startswith("### "):
            label = line[4:]
            output.append(f'<h3 id="{detail_id(label)}">{rich(label)}</h3>')
            continue
        if line.startswith("|"):
            if not next_line or not next_line.startswith("|"):
                raise ValueError("Table separator is missing")
            output.extend(['<div class="table-scroll"><table><thead>', table_row(line, "th"), "</thead><tbody>"])
            next_line = next(lines, None)
            while next_line and next_line.startswith("|"):
                output.append(table_row(next_line, "td"))
                next_line = next(lines, None)
            output.append("</tbody></table></div>")
            continue
        marker = re.match(r"(-|\d+\.) ", line)
        if marker:
            tag = "ul" if marker[1] == "-" else "ol"
            prefix = r"- " if tag == "ul" else r"\d+\. "
            output.extend([f"<{tag}>", f"<li>{rich(line[marker.end():])}</li>"])
            while next_line and (item := re.match(prefix, next_line)):
                output.append(f"<li>{rich(next_line[item.end():])}</li>")
                next_line = next(lines, None)
            output.append(f"</{tag}>")
            continue
        output.append(f"<p>{rich(line)}</p>")
    return "\n".join(output)


class Structure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.anchors = []
        self.tables = 0

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if "id" in attributes:
            self.ids.append(attributes["id"])
        if (href := attributes.get("href")) and href.startswith("#"):
            self.anchors.append(href[1:])
        if tag == "table":
            self.tables += 1


def main():
    docs = Path(__file__).resolve().parents[1] / "docs"
    source = (docs / "MASTER_DEVELOPMENT_PLAN.md").read_text(encoding="utf-8").splitlines()
    title, intro = source[0].removeprefix("# "), source[2]
    sections = []
    for line in source[4:]:
        if line.startswith("## "):
            sections.append((line[3:], []))
        elif sections:
            sections[-1][1].append(line)
    if not sections:
        raise ValueError("Master plan has no sections")

    links = []
    content = []
    for index, (title_text, lines) in enumerate(sections, 1):
        label = escape(title_text)
        detail_links = [
            f'<li><a href="#{detail_id(line[4:])}">{escape(line[4:])}</a></li>'
            for line in lines if line.startswith("### ")
        ]
        children = "<ul>" + "".join(detail_links) + "</ul>" if detail_links else ""
        links.append(f'<li><a href="#plan-{index}">{label}</a>{children}</li>')
        content.append(f'<section aria-labelledby="plan-{index}"><h2 id="plan-{index}">{label}</h2>')
        content.extend([render_section(lines), "</section>"])

    target = docs / "dev-plan.html"
    head, separator, _ = target.read_text(encoding="utf-8").partition("</head>")
    if not separator:
        raise ValueError("Master plan HTML template has no head")
    head = re.sub(r"<title>.*?</title>", lambda _: f"<title>{escape(title)}</title>", head, count=1)
    sections_html = "\n".join(content)
    html = head + f"""</head>
<body>
<div class="shell">
<nav aria-label="목차"><ul>{''.join(links)}</ul></nav>
<main><header class="hero"><h1>{escape(title)}</h1><p>{escape(intro)}</p></header>
{sections_html}
</main>
</div>
</body>
</html>
"""
    parsed = Structure()
    parsed.feed(html)
    if not parsed.ids or len(set(parsed.ids)) != len(parsed.ids) or sorted(parsed.ids) != sorted(parsed.anchors):
        raise ValueError("Master plan HTML has inconsistent section links")
    temp = target.with_suffix(".html.tmp")
    temp.write_text(html, encoding="utf-8", newline="\n")
    temp.replace(target)
    print(f"Synced {len(sections)} sections, {parsed.tables} tables and {len(parsed.anchors)} anchors")


if __name__ == "__main__":
    main()
