import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class AuthorizeDto {
  @IsIn(['code'])
  response_type: string;

  @IsUUID()
  client_id: string;

  @IsString()
  redirect_uri: string;

  @IsString()
  code_challenge: string;

  @IsIn(['S256'])
  code_challenge_method: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  state?: string;
}
