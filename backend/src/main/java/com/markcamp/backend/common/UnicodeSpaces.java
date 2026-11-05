package com.markcamp.backend.common;

/**
 * The single definition of what counts as a space: Unicode spaces too, because strip() and isBlank() alone would not
 * see NBSP.
 */
public final class UnicodeSpaces {

	private UnicodeSpaces() {
	}

	/**
	 * Only for names, which are human text and get cleaned.
	 */
	public static String trim(String value) {
		int start = 0;
		int end = value.length();
		while (start < end && isSpace(value.charAt(start))) {
			start++;
		}
		while (end > start && isSpace(value.charAt(end - 1))) {
			end--;
		}
		return value.substring(start, end);
	}

	/**
	 * The REQUIRED check for fields that are not names (ADR 0006). It only tests: callers parse the original value, so a
	 * valid id with spaces around it stays INVALID_FORMAT. An id, a timestamp or a type is machine data, and a client that
	 * sends it padded has a bug we want to see.
	 */
	public static boolean isNullOrBlank(String value) {
		return value == null || trim(value).isEmpty();
	}

	private static boolean isSpace(char character) {
		return Character.isWhitespace(character) || Character.isSpaceChar(character);
	}

}
