import { IsIn, IsOptional, IsString } from 'class-validator';

export class TokenDto {
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type: 'authorization_code' | 'refresh_token';

  // authorization_code grant
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  code_verifier?: string;

  // refresh_token grant
  @IsOptional()
  @IsString()
  refresh_token?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  // client auth (public clients send client_id only; confidential clients
  // may also send client_secret)
  @IsOptional()
  @IsString()
  client_id?: string;

  @IsOptional()
  @IsString()
  client_secret?: string;
}
