import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

/**
 * RFC 7591 Dynamic Client Registration request body.
 */
export class RegisterClientDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl({ require_tld: false }, { each: true })
  redirect_uris: string[];

  @IsOptional()
  @IsString()
  client_name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  client_uri?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logo_uri?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grant_types?: string[];

  @IsOptional()
  @IsIn(['none', 'client_secret_post'])
  token_endpoint_auth_method?: string;

  @IsOptional()
  @IsString()
  scope?: string;
}
