package com.markcamp.backend.common;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.type.LogicalType;

@Configuration
class JacksonConfig {

	// A wrong JSON type is an error (ADR 0006). spring.jackson.mapper.allow-coercion-of-scalars=false does not cover
	// this direction, because Jackson does not count String among the scalar targets, and no property does.
	@Bean
	JsonMapperBuilderCustomizer rejectScalarsAsStrings() {
		return (builder) -> builder.withCoercionConfig(LogicalType.Textual, (config) -> config
			.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
			.setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
			.setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail));
	}

}
