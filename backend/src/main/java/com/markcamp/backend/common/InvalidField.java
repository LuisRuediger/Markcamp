package com.markcamp.backend.common;

/**
 * One entry of {@code errors} in a VALIDATION_FAILED response. {@code field} is the name in the JSON body, not in Java.
 */
public record InvalidField(String field, FieldCode code) {
}
