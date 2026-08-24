#!/bin/sh

set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
SOURCE_DIR="${PROJECT_DIR}/dev/v1.2"
RELEASE_DIR="${PROJECT_DIR}/../releases"
INFO_FILE="${SOURCE_DIR}/INFO"

if [ ! -f "${INFO_FILE}" ]; then
    printf 'ERROR: package metadata not found: %s\n' "${INFO_FILE}" >&2
    exit 1
fi

PACKAGE=$(sed -n 's/^package="\([^"]*\)"$/\1/p' "${INFO_FILE}")
VERSION=$(sed -n 's/^version="\([^"]*\)"$/\1/p' "${INFO_FILE}")

if [ -z "${PACKAGE}" ] || [ -z "${VERSION}" ]; then
    printf 'ERROR: package or version is missing from %s\n' "${INFO_FILE}" >&2
    exit 1
fi

BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/${PACKAGE}-build.XXXXXX")
PAYLOAD_DIR="${BUILD_DIR}/payload"
SPK_DIR="${BUILD_DIR}/spk"
OUTPUT_FILE="${RELEASE_DIR}/${PACKAGE}-${VERSION}.spk"

cleanup()
{
    case "${BUILD_DIR}" in
        "${TMPDIR:-/tmp}/${PACKAGE}-build."*)
            rm -rf -- "${BUILD_DIR}"
            ;;
    esac
}
trap cleanup EXIT HUP INT TERM

# Prevent macOS from adding AppleDouble files and extended attributes to archives.
export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1

mkdir -p "${PAYLOAD_DIR}" "${SPK_DIR}" "${RELEASE_DIR}"
cp -R "${SOURCE_DIR}/app/." "${PAYLOAD_DIR}/"

ICON_DIR="${PAYLOAD_DIR}/ui/images"
mkdir -p "${ICON_DIR}"

resize_icon()
{
    size=$1
    output=$2

    if command -v magick >/dev/null 2>&1; then
        magick "${SOURCE_DIR}/PACKAGE_ICON.PNG" -resize "${size}x${size}" "${output}"
    elif command -v convert >/dev/null 2>&1; then
        convert "${SOURCE_DIR}/PACKAGE_ICON.PNG" -resize "${size}x${size}" "${output}"
    elif command -v sips >/dev/null 2>&1; then
        sips -z "${size}" "${size}" "${SOURCE_DIR}/PACKAGE_ICON.PNG" --out "${output}" >/dev/null
    elif [ "${size}" -le 256 ]; then
        cp "${SOURCE_DIR}/PACKAGE_ICON_256.PNG" "${output}"
    else
        cp "${SOURCE_DIR}/PACKAGE_ICON.PNG" "${output}"
    fi
}

for size in 16 24 28 32 48 56 64 72 128 256 512; do
    resize_icon "${size}" "${ICON_DIR}/app_${size}.png"
done

find "${PAYLOAD_DIR}" -type d -exec chmod 755 {} +
find "${PAYLOAD_DIR}" -type f -exec chmod 644 {} +
chmod 755 "${PAYLOAD_DIR}/bin/pty_service.py"
find "${PAYLOAD_DIR}/ui" -type f -name '*.cgi' -exec chmod 755 {} +

tar -czf "${SPK_DIR}/package.tgz" -C "${PAYLOAD_DIR}" .

cp "${INFO_FILE}" "${SOURCE_DIR}/PACKAGE_ICON.PNG" "${SPK_DIR}/"
cp "${SOURCE_DIR}/PACKAGE_ICON_256.PNG" "${SPK_DIR}/"
cp -R "${SOURCE_DIR}/WIZARD_UIFILES" "${SOURCE_DIR}/conf" "${SPK_DIR}/"
cp -R "${SOURCE_DIR}/scripts" "${SPK_DIR}/"

find "${SPK_DIR}" -type d -exec chmod 755 {} +
find "${SPK_DIR}" -type f -exec chmod 644 {} +
find "${SPK_DIR}/scripts" -type f -exec chmod 755 {} +

TEMP_OUTPUT="${BUILD_DIR}/${PACKAGE}-${VERSION}.spk"
tar -cf "${TEMP_OUTPUT}" -C "${SPK_DIR}" INFO PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG WIZARD_UIFILES conf scripts package.tgz
mv -f "${TEMP_OUTPUT}" "${OUTPUT_FILE}"

printf 'Created %s\n' "${OUTPUT_FILE}"
