"""Package installers, the extension, and instructions for sharing.

Run only after building both installers. No installed user profile is read.
Use --verification PATH to include actual release-specific verification results.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED
import argparse
import hashlib
import json
import re
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verification", type=Path,
                        help="Optional UTF-8 verification record for this release")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    version = json.loads((project / "package.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise RuntimeError("package.json 版本号格式无效")
    destination = project.parent / "outputs" / ("ThunderFantasy-" + version)
    manifest = json.loads((project / "extension/manifest.json").read_text(encoding="utf-8"))
    if manifest["version"] != version.split("-")[0]:
        raise RuntimeError("应用与扩展版本不一致，请先同步版本")
    docs = project / "使用说明.md"
    if not docs.is_file():
        raise RuntimeError("缺少使用说明.md")
    verification = args.verification.read_text(encoding="utf-8") if args.verification else ""
    variants = [
        ("Mac-Apple", project / ("release/mac/ThunderFantasy-" + version + "-mac-arm64.dmg")),
        ("Windows-x64", project / ("release/windows/ThunderFantasy-" + version + "-win-x64.exe")),
    ]
    for _, installer in variants:
        if not installer.is_file() or installer.is_symlink() or installer.stat().st_size < 50_000_000:
            raise RuntimeError("安装包缺失或过小：" + installer.name)
    extension = sorted(p for p in (project / "extension").iterdir()
                       if p.suffix in (".js", ".json", ".html"))
    if any(not p.is_file() or p.is_symlink() for p in extension):
        raise RuntimeError("扩展中存在不允许的文件或链接")
    destination.mkdir(parents=True, exist_ok=True)
    quick = """Thunder Fantasy VERSION · 通用测试版

不需要 Codex、Python、Node.js 或模型 API，日常使用不消耗模型 token。

1. 将整个 ZIP 解压到固定位置。建议放到“文档/ThunderFantasy”下。
   YahooSync 文件夹是扩展，不要在加载扩展之后移动或删除它。
2. Windows 10/11 x64：运行内附的 EXE 安装程序，再启动 Thunder Fantasy。
   Mac（macOS 13+）：打开对应芯片的 DMG，将应用拖到 Applications。
3. Edge 打开 edge://extensions/；Chrome 打开 chrome://extensions/。
   开启开发人员模式，点击“加载解压缩的扩展”，选择 YahooSync 文件夹。
4. 在桌面应用“设置与配对”生成六位配对码，在扩展弹窗输入并连接。
5. 浏览器登录自己的 Yahoo，打开自己的 My Team 球队页。
   点击扩展图标，核对识别到的球队，再点击“导入当前球队”。
   导入后自动请求首次同步。多个联盟可以逐个导入，之后在应用内切换。
   联盟首页和 Matchups 对局页不能用于导入，请先进入 My Team。
6. 也可以在桌面应用手动填写联盟名称、联盟 ID、球队 ID 并保存。
   球队页地址 /nba/12345/6 中，12345 是联盟 ID，6 是球队 ID。

请保持桌面应用运行，并保留一个已配置的 Yahoo 联盟标签页。
自动同步每十分钟一次，更新今天有比赛的自有球员及当周全盟战力。
手动刷新会更新球员场均和全盟数据。自由球员候选通过单独按钮更新；
每日 16:00 自动更新需要自行勾选，默认关闭。没有启用每周自动导出。

导出：收齐全盟数据后，点击“导出 HTML、Excel 和图片”，选择目录。
HTML 单文件可离线排序、切换联盟和背景色。每盟导出 5 张 PNG。

本包从空配置启动，没有开发者的个人联盟、球队、登录或配对凭证。
Mac Apple 与 Windows 仍需要相应电脑实机验证；真实 Yahoo 同步依赖
对方自己的登录状态和网页结构。没有 Apple 公证或 Windows 发布者签名，
系统可能提示未验证开发者。本包是测试版，具体测试范围见随发布提供的记录。

请测试：安装/启动 → 扩展配对 → 从 My Team 导入 → 首次同步
→ 联盟切换 → 球员与全盟数据 → HTML/Excel/PNG 导出 → 退出与重启。
问题反馈请附系统/浏览器版本、失败步骤、状态栏错误文字或截图，
请不要分享配对码、浏览器凭证或无关个人信息。

2.1.10 起支持应用内检查、下载及重启安装。首次从旧版升级仍需安装本版一次。
推荐在“设置与配对 → 应用更新”打开应用管理的扩展目录，浏览器加载
那个 YahooSync；以后扩展文件会随应用维护，弹窗提示时刷新 Yahoo 页面。
完整说明见同目录“使用说明.md”。
旧版升级时也要更新 YahooSync 中的全部文件，重新加载扩展，并刷新所有
Yahoo 联盟标签页；只更新桌面应用不会替换浏览器里的旧同步脚本。
""".replace("VERSION", version)
    for label, installer in variants:
        root = "ThunderFantasy-" + version + "-" + label
        target = destination / (root + ".zip")
        temporary = target.with_suffix(".zip.tmp")
        try:
            with ZipFile(temporary, "w", compression=ZIP_STORED, allowZip64=True) as archive:
                archive.write(installer, root + "/" + installer.name)
                for source in extension:
                    archive.write(source, root + "/YahooSync/" + source.name, compress_type=ZIP_DEFLATED)
                archive.writestr(root + "/快速开始.txt", "\ufeff" + quick.replace("\n", "\r\n"), compress_type=ZIP_DEFLATED)
                archive.write(docs, root + "/使用说明.md", compress_type=ZIP_DEFLATED)
            with ZipFile(temporary) as archive:
                if archive.testzip() is not None:
                    raise RuntimeError("压缩包校验失败：" + target.name)
                expected = {root + "/" + installer.name, root + "/快速开始.txt", root + "/使用说明.md"}
                expected.update(root + "/YahooSync/" + source.name for source in extension)
                if set(archive.namelist()) != expected:
                    raise RuntimeError("转发包内容与允许清单不一致")
            temporary.replace(target)
        finally:
            if temporary.exists():
                temporary.unlink()
        print("已生成并校验：{} · {:.1f} MiB".format(target.name, target.stat().st_size / 1024**2))
    (destination / "使用说明.md").write_text(docs.read_text(encoding="utf-8"), encoding="utf-8")
    notes = """Thunder Fantasy VERSION 打包检查记录

本脚本检查了两个安装包存在、文件大小符合预期、应用与扩展版本一致；
两个转发 ZIP 的 CRC 和文件清单均通过检查，SHA-256 见 SHA256SUMS.txt。
转发包只包含安装程序、扩展及使用说明，不复制已安装应用的用户数据。
GitHub 源码包通过允许清单生成，不包含构建缓存或用户配置。

这些打包检查不代表已在对应系统运行，也不代表真实 Yahoo 账号同步成功。
运行测试、依赖审计、签名校验等结果仅以本版本单独的实际验证记录为准。
Mac Apple 与 Windows 需要相应电脑实机测试。安装包没有开发者身份签名/公证。
""".replace("VERSION", version)
    if verification:
        notes += "\n本版本实际验证记录：\n\n" + verification
    (destination / "验证记录.txt").write_text(notes, encoding="utf-8")
    subprocess.run([sys.executable, str(project / "scripts/package-source.py")], check=True)
    hashes = []
    for file in sorted(destination.glob("*.zip")):
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        hashes.append("{}  {}".format(digest.hexdigest(), file.name))
    (destination / "SHA256SUMS.txt").write_text("\n".join(hashes) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
