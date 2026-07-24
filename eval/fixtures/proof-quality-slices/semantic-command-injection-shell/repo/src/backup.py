import subprocess


def create_archive(source_dir: str, archive_name: str) -> None:
    """Create a gzipped tar archive of source_dir named archive_name."""
    command = f"tar -czf {archive_name}.tar.gz {source_dir}"
    subprocess.run(command, shell=True, check=True)
